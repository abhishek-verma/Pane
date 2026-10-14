import { hasPendingToolApprovals } from '@/modules/chat/collect-tool-approval-responses'
import { composerFileParts } from '@/modules/chat/composer-message'
import {
  type ComposerState,
  composerKey,
  type QueuedMessage,
  readComposer,
  recoverComposer,
  settleQueuedMessage,
  updateComposer,
} from '@/modules/chat/composer-store'
import { providersStorage } from '../llm-providers/storage'
import { displayTabUrl } from '../personal-internet/attachable-tab-url'
import {
  conversationTrustStorage,
  requireBrowserInputApprovalStorage,
  trustPinsStorage,
} from '../trust/trust-pins-storage'
import { recordQueuedExecution } from './queue-record'
import type { ChatRepository } from './repository'
import type { PreparedChatRequest } from './types'

export { durableChatRequest } from './queue-request'

import { hasApprovalRespondedParts } from '@/modules/chat/reconcile-tool-states'
import { approvalKey } from './approvals'
import { credentialFields } from './queue-request'

function settle(
  value: ComposerState,
  candidate: QueuedMessage,
  success: boolean,
) {
  const next = settleQueuedMessage(value, candidate.id, success)
  return success && candidate.pauseAfter
    ? { ...next, paused: true, note: 'Queued messages remain paused.' }
    : next
}
function hasPendingDelivery(state: ComposerState | undefined) {
  return Boolean(state?.queue[0]?.state === 'sending' && state.queue[0].started)
}
export function startRepositoryQueue(repository: ChatRepository) {
  const pending = new Set<string>()
  const running = new Map<string, Promise<void>>()
  const kick = (id: string): Promise<void> => {
    const existing = running.get(id)
    if (existing) return existing
    const task = drain(id).then(
      (advanced) => {
        running.delete(id)
        if (advanced && pending.has(id)) void kick(id).catch(() => {})
      },
      (error) => {
        running.delete(id)
        throw error
      },
    )
    running.set(id, task)
    return task
  }
  const drain = async (id: string) => {
    const key = composerKey(id)
    // Retain the existing lock during upgrades so an older extension view
    // cannot dispatch the same durable queue alongside this owner.
    return navigator.locks.request(`chat-dispatch:${id}`, async () => {
      const state = await readComposer(key)
      if (!state.queue.length || (state.paused && !hasPendingDelivery(state))) {
        pending.delete(id)
        return
      }
      pending.add(id)
      let candidate = state.queue[0]
      if (candidate.state === 'sending' && !candidate.started) {
        await updateComposer(key, recoverComposer)
        return
      }
      if (candidate.state === 'review') return
      await repository.refresh(id)
      if (repository.peek(id).busy && !candidate.started) return
      if (candidate.prepared) {
        await repository.configure(id, candidate.prepared)
        await repository.refresh(id)
        if (repository.peek(id).busy && !candidate.started) return
      }
      if (
        !candidate.started &&
        candidate.kind !== 'approval' &&
        (hasPendingToolApprovals(repository.peek(id).messages) ||
          hasApprovalRespondedParts(repository.peek(id).messages))
      )
        return
      if (candidate.started) {
        const result = await repository.recover(id, candidate.started.turnId)
        if (result !== 'pending')
          await recordQueuedExecution(
            id,
            candidate,
            repository.peek(id).messages,
            result === 'done' ? 'completed' : 'stopped',
          ).catch(() => {})
        if (result !== 'pending' && candidate.kind === 'approval')
          await chrome.storage.local.remove(approvalKey(id))
        if (result !== 'pending')
          await updateComposer(key, (value) =>
            settle(value, candidate, result === 'done'),
          )
        return result === 'done'
      }
      if (!candidate.prepared) {
        await updateComposer(key, (value) => ({
          ...value,
          paused: true,
          note: 'This queued message was created before the chat update. Restore it and send again.',
        }))
        return
      }
      // Claim atomically; the user may pause/remove/edit while liveness loads.
      let claimed = false
      await updateComposer(key, (value) => {
        if (
          value.paused ||
          value.queue[0]?.id !== candidate.id ||
          value.queue[0].state !== 'queued'
        )
          return value
        candidate = { ...value.queue[0], startedAt: new Date().toISOString() }
        claimed = true
        return {
          ...value,
          queue: value.queue.map((item) =>
            item.id === candidate.id
              ? { ...item, state: 'sending', startedAt: candidate.startedAt }
              : item,
          ),
        }
      })
      if (!claimed) return
      await recordQueuedExecution(id, candidate, [], 'running').catch(() => {})
      try {
        for (const tab of candidate.message.action?.tabs ?? []) {
          if (tab.id == null) continue
          const current = await chrome.tabs.get(tab.id)
          if (displayTabUrl(current.url) !== displayTabUrl(tab.url))
            throw new Error(
              `“${tab.title}” changed after this message was queued. Restore it and reattach the page.`,
            )
        }
        const request: PreparedChatRequest = {
          ...candidate.prepared!,
          body: {
            ...candidate.prepared!.body,
            message:
              candidate.kind === 'approval'
                ? ''
                : candidate.message.text || 'Please review the attached files.',
            attachments:
              candidate.kind === 'approval'
                ? undefined
                : candidate.message.attachments?.map((item) => item.payload),
            clientMessageId:
              candidate.kind === 'approval'
                ? candidate.prepared?.body.clientMessageId
                : candidate.id,
          },
        }
        if (request.path === '/chat') {
          const provider = ((await providersStorage.getValue()) ?? []).find(
            (item) => item.id === request.body.providerId,
          )
          if (!provider)
            throw new Error(
              'The queued provider is no longer available. Restore the message and choose another provider.',
            )
          if (
            provider.baseUrl !== request.body.baseUrl ||
            provider.type !== request.body.providerType
          )
            throw new Error(
              'The queued provider configuration changed. Restore the message and send again.',
            )
          for (const field of credentialFields)
            request.body[field] = provider[field]
        }
        const pins = { ...(await trustPinsStorage.getValue()) }
        const conversationPins =
          (await conversationTrustStorage.getValue())[id] ?? {}
        for (const [key, trusted] of Object.entries(conversationPins))
          if (trusted) pins[key as keyof typeof pins] = { pinned: true }
        request.body.trustPins = pins
        request.body.requireBrowserInputApproval =
          await requireBrowserInputApprovalStorage.getValue()
        const history = repository.peek(id).messages
        const messages =
          candidate.kind === 'approval'
            ? history
            : [
                ...history,
                {
                  id: candidate.id,
                  role: 'user' as const,
                  parts: [
                    {
                      type: 'text' as const,
                      text:
                        candidate.message.text ||
                        'Please review the attached files.',
                    },
                    ...composerFileParts(candidate.message.attachments),
                  ],
                  metadata: { conversationId: id, composer: candidate.message },
                },
              ]
        const result = await repository.run(
          id,
          request,
          messages,
          async (event) => {
            if (event.type === 'accepted')
              await updateComposer(key, (value) => ({
                ...value,
                queue: value.queue.map((item) =>
                  item.id === candidate.id
                    ? {
                        ...item,
                        started: { turnId: event.turnId, conversationId: id },
                      }
                    : item,
                ),
              }))
          },
        )
        await recordQueuedExecution(
          id,
          candidate,
          repository.peek(id).messages,
          result.outcome === 'pending'
            ? 'running'
            : result.outcome === 'done'
              ? 'completed'
              : 'stopped',
        ).catch(() => {})
        if (result.outcome !== 'pending' && candidate.kind === 'approval')
          await chrome.storage.local.remove(approvalKey(id))
        if (result.outcome !== 'pending')
          await updateComposer(key, (value) =>
            settle(value, candidate, result.outcome === 'done'),
          )
        return result.outcome === 'done'
      } catch (error) {
        await recordQueuedExecution(
          id,
          candidate,
          repository.peek(id).messages,
          'failed',
        ).catch(() => {})
        await updateComposer(key, (value) => ({
          ...settle(value, candidate, false),
          note: error instanceof Error ? error.message : String(error),
        }))
      }
    })
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith('chat-composer-v2:')) continue
      const id = key.slice('chat-composer-v2:'.length)
      const value = change.newValue as ComposerState | undefined
      if (
        value?.queue?.length &&
        (!value.paused || hasPendingDelivery(value))
      ) {
        pending.add(id)
        void kick(id).catch(() => {})
      } else pending.delete(id)
    }
  })
  let initialized = false
  let initializing: Promise<void> | undefined
  const scan = async () => {
    if (!initialized) {
      initializing ??= (async () => {
        const keys = (await chrome.storage.local.getKeys()).filter((key) =>
          key.startsWith('chat-composer-v2:'),
        )
        const values = await chrome.storage.local.get(keys)
        for (const [key, raw] of Object.entries(values)) {
          const value = raw as ComposerState
          if (
            value?.queue?.length &&
            (!value.paused || hasPendingDelivery(value))
          )
            pending.add(key.slice('chat-composer-v2:'.length))
        }
        initialized = true
      })().finally(() => {
        initializing = undefined
      })
      await initializing
    }
    for (const id of pending) void kick(id).catch(() => {})
  }
  return { kick, scan }
}
