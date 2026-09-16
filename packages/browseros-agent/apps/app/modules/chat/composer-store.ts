import type { StagedAttachment } from '@/lib/attachments'
import type { ComposerMessage } from './composer-message'

export interface ChatDraft {
  text: string
  tabs: chrome.tabs.Tab[]
  attachments: StagedAttachment[]
}
export interface QueuedMessage {
  id: string
  message: ComposerMessage
  state: 'queued' | 'sending' | 'review'
  waitsForSuccess?: boolean
  started?: { turnId: string; conversationId: string }
}
export interface ComposerState {
  revision?: number
  draft: ChatDraft
  queue: QueuedMessage[]
  paused: boolean
  note?: string
}
export const emptyDraft = (): ChatDraft => ({
  text: '',
  tabs: [],
  attachments: [],
})
export const emptyComposer = (): ComposerState => ({
  draft: emptyDraft(),
  queue: [],
  paused: false,
})
export const composerKey = (conversationId: string, _targetId?: string) =>
  `chat-composer-v2:${conversationId}`

/** Merge provider-scoped drafts/queues once, under the same write lock. */
export async function migrateComposer(conversationId: string): Promise<void> {
  const key = composerKey(conversationId)
  await navigator.locks.request(`${key}:write`, async () => {
    if ((await chrome.storage.local.get(key))[key]) return
    const keys = (await chrome.storage.local.getKeys()).filter((name) =>
      name.startsWith(`chat-composer-v1:${conversationId}:`),
    )
    const legacy = Object.entries(await chrome.storage.local.get(keys))
    if (!legacy.length) return
    const merged = emptyComposer()
    for (const [, raw] of legacy) {
      const value = raw as ComposerState
      if (!merged.draft.text && !merged.draft.attachments.length)
        merged.draft = value.draft
      merged.queue.push(
        ...value.queue.filter(
          (item) => !merged.queue.some((existing) => existing.id === item.id),
        ),
      )
    }
    await chrome.storage.local.set({ [key]: recoverComposer(merged) })
  })
}
export async function readComposer(key: string): Promise<ComposerState> {
  return (
    ((await chrome.storage.local.get(key))[key] as ComposerState | undefined) ??
    emptyComposer()
  )
}
/** Web Locks + profile-scoped extension storage serialize panel/full-page writes. */
export async function updateComposer(
  key: string,
  update: (state: ComposerState) => ComposerState,
) {
  return navigator.locks.request(`${key}:write`, async () => {
    const current = await readComposer(key)
    const next = update(current)
    if (next === current) return current
    const saved = { ...next, revision: (current.revision ?? 0) + 1 }
    await chrome.storage.local.set({ [key]: saved })
    return saved
  })
}

export function settleQueuedMessage(
  state: ComposerState,
  id: string,
  success: boolean,
): ComposerState {
  return {
    ...state,
    queue: success
      ? state.queue
          .filter((item) => item.id !== id)
          .map((item) => ({ ...item, waitsForSuccess: false }))
      : state.queue.flatMap((item) =>
          item.id !== id
            ? [item]
            : item.started
              ? []
              : [{ ...item, state: 'review' as const }],
        ),
    paused: success ? state.paused : true,
    note: success
      ? undefined
      : 'The response stopped. Send the remaining messages when you are ready.',
  }
}

export function recoverComposer(state: ComposerState): ComposerState {
  if (!state.queue.length) return state
  const interrupted = state.queue.some(
    (item) => item.state === 'sending' && !item.started,
  )
  return {
    ...state,
    paused:
      (state.paused && !!state.note) ||
      interrupted ||
      state.queue.some((item) => item.state === 'review'),
    note: interrupted
      ? 'Delivery could not be confirmed. Restore the message to retry.'
      : state.note,
    queue: state.queue.map((item) =>
      item.state === 'sending' && !item.started
        ? { ...item, state: 'review' }
        : item,
    ),
  }
}

export function removeAcceptedDraft(
  current: ChatDraft,
  sent: ChatDraft,
): ChatDraft {
  // New prose may still reference the submitted context. Preserve the whole
  // edited draft; otherwise remove only attachments that were actually sent.
  if (current.text !== sent.text) return current
  return {
    text: '',
    tabs: current.tabs.filter(
      (tab) => !sent.tabs.some((item) => item.id === tab.id),
    ),
    attachments: current.attachments.filter(
      (attachment) =>
        !sent.attachments.some((item) => item.id === attachment.id),
    ),
  }
}
