import {
  attachChatTurnStream,
  fetchActiveChatTurn,
} from '@/lib/conversations/chat-turn-api'
import { displayTabUrl } from '@/lib/personal-internet/attachable-tab-url'
import type { ComposerMessage } from './composer-message'
import {
  type ComposerState,
  settleQueuedMessage,
  updateComposer,
} from './composer-store'

export interface DispatchSession {
  canSend: boolean
  isRestoringConversation: boolean
  lastTurnSucceeded: boolean
  sendComposerMessage: (
    message: ComposerMessage,
    onAccepted?: (started: {
      turnId: string
      conversationId: string
    }) => Promise<void>,
  ) => Promise<'done' | 'paused' | 'pending'>
}

export async function dispatchNextComposerMessage(options: {
  key: string
  dispatchKey: string
  conversationId?: string
  signal: AbortSignal
  isCurrent: () => boolean
  getSession: () => DispatchSession
}) {
  const { key, dispatchKey, signal, isCurrent, getSession } = options
  try {
    // Wait for the current owner to release the complete turn. A nonblocking
    // attempt can miss the final storage event and strand the next message.
    await navigator.locks.request(dispatchKey, { signal }, async () => {
      if (signal.aborted || !isCurrent()) return
      const session = getSession()
      if (session.isRestoringConversation) return
      // Another view may have started a turn since this view last rendered.
      const active = options.conversationId
        ? await fetchActiveChatTurn(options.conversationId)
        : null
      if (signal.aborted || !isCurrent()) return
      let candidate: ComposerState['queue'][number] | undefined
      await updateComposer(key, (value) => {
        if (value.paused || !value.queue.length) return value
        const first = value.queue[0]
        if (first.state === 'sending' && first.started) {
          candidate = first
          return value
        }
        if (!session.canSend || active?.status === 'running') return value
        if (first.state !== 'queued')
          return {
            ...value,
            paused: true,
            note: 'A previous delivery needs review. It will not be sent again automatically.',
            queue: value.queue.map((item) =>
              item.id === first.id ? { ...item, state: 'review' } : item,
            ),
          }
        candidate = first
        return {
          ...value,
          queue: value.queue.map((item) =>
            item.id === first.id ? { ...item, state: 'sending' } : item,
          ),
        }
      })
      if (!candidate) return
      const messageId = candidate.id
      try {
        if (candidate.started) {
          let outcome: 'done' | 'paused' | 'pending' = 'pending'
          try {
            await attachChatTurnStream({
              ...candidate.started,
              signal: AbortSignal.timeout(30_000),
              onEvent: (event) => {
                if (event.type === 'done')
                  outcome = event.status === 'done' ? 'done' : 'paused'
              },
            })
          } catch {
            // Keep the receipt across temporary outages; never resend it.
            return
          }
          if (outcome !== 'pending')
            await updateComposer(key, (value) =>
              settleQueuedMessage(value, messageId, outcome === 'done'),
            )
          return
        }
        for (const tab of candidate.message.action?.tabs ?? []) {
          if (tab.id == null) continue
          const current = await chrome.tabs.get(tab.id)
          if (displayTabUrl(current.url) !== displayTabUrl(tab.url))
            throw new Error(
              `“${tab.title}” has moved. Restore the queued message to your draft and reattach the page.`,
            )
        }
        if (!isCurrent())
          throw new Error(
            'Conversation changed. Resume this queue when you return.',
          )
        // Effect cleanup cancels waiting owners, never an already dispatched turn.
        const outcome = await session.sendComposerMessage(
          candidate.message,
          async (started) => {
            await updateComposer(key, (value) => ({
              ...value,
              queue: value.queue.map((item) =>
                item.id === messageId ? { ...item, started } : item,
              ),
            }))
          },
        )
        if (outcome === 'pending') return
        await updateComposer(key, (value) =>
          settleQueuedMessage(value, messageId, outcome === 'done'),
        )
      } catch (error) {
        await updateComposer(key, (value) => ({
          ...settleQueuedMessage(value, messageId, false),
          note:
            error instanceof Error
              ? error.message
              : 'Delivery failed. Your message is kept for review.',
        }))
      }
    })
  } catch (error) {
    if (!signal.aborted) throw error
  }
}
