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
}
export interface ComposerState {
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
  paused: true,
})
export const composerKey = (conversationId: string, targetId: string) =>
  `chat-composer-v1:${conversationId}:${targetId}`
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
    const next = update(await readComposer(key))
    await chrome.storage.local.set({ [key]: next })
    return next
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
      : state.queue.map((item) =>
          item.id === id ? { ...item, state: 'review' } : item,
        ),
    paused: success ? state.paused : true,
    note: success
      ? undefined
      : 'Delivery did not finish successfully. Review the last message before continuing.',
  }
}

export function recoverComposer(state: ComposerState): ComposerState {
  if (!state.queue.length) return state
  const interrupted = state.queue.some((item) => item.state === 'sending')
  return {
    ...state,
    paused: true,
    note: interrupted
      ? 'Delivery was interrupted. Review the last message before sending it again.'
      : state.note,
    queue: state.queue.map((item) =>
      item.state === 'sending' ? { ...item, state: 'review' } : item,
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
