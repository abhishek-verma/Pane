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
  sendComposerMessage: (message: ComposerMessage) => Promise<'done' | 'paused'>
}

export async function dispatchNextComposerMessage(options: {
  key: string
  dispatchKey: string
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
      if (!session.canSend || session.isRestoringConversation) return
      let candidate: ComposerState['queue'][number] | undefined
      await updateComposer(key, (value) => {
        if (value.paused || !value.queue.length) return value
        const first = value.queue[0]
        if (first.waitsForSuccess && !session.lastTurnSucceeded)
          return {
            ...value,
            paused: true,
            note: 'The previous response stopped or could not be confirmed. Resume when you are ready.',
            queue: value.queue.map((item) => ({
              ...item,
              waitsForSuccess: false,
            })),
          }
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
        const outcome = await session.sendComposerMessage(candidate.message)
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
