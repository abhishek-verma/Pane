/**
 * Cursor-style resident message window helpers.
 * Older pages are fetched from the server; excess messages are dropped from
 * the opposite end so renderer heap stays bounded.
 */

import { UI_CHAT_LIMITS } from '@browseros/shared/constants/limits'
import type { UIMessage } from 'ai'

export const CHAT_PAGE_SIZE = UI_CHAT_LIMITS.PAGE_SIZE
export const CHAT_MAX_RESIDENT = UI_CHAT_LIMITS.MAX_RESIDENT_MESSAGES

/**
 * Prepend older messages and drop from the newest end when over the resident
 * cap. Never drops the last `keepTail` messages (live turn / resume tail).
 */
export function mergeOlderMessages(args: {
  current: UIMessage[]
  older: UIMessage[]
  maxResident?: number
  keepTail?: number
}): { messages: UIMessage[]; droppedNewest: number } {
  const maxResident = args.maxResident ?? CHAT_MAX_RESIDENT
  const keepTail = Math.max(0, args.keepTail ?? 2)
  const seen = new Set(args.current.map((m) => m.id))
  const uniqueOlder = args.older.filter((m) => !seen.has(m.id))
  let merged = [...uniqueOlder, ...args.current]
  let droppedNewest = 0
  if (merged.length <= maxResident) {
    return { messages: merged, droppedNewest }
  }
  const overflow = merged.length - maxResident
  const protectedStart = Math.max(0, merged.length - keepTail)
  // Drop from the end of the non-protected middle/newest settled region.
  const dropFrom = Math.max(uniqueOlder.length, protectedStart - overflow)
  const dropCount = Math.min(overflow, protectedStart - dropFrom)
  if (dropCount > 0) {
    merged = [
      ...merged.slice(0, dropFrom),
      ...merged.slice(dropFrom + dropCount),
    ]
    droppedNewest = dropCount
  }
  // If still over (keepTail alone exceeds max), hard-cap from the front.
  if (merged.length > maxResident) {
    const trim = merged.length - maxResident
    merged = merged.slice(trim)
    droppedNewest += trim
  }
  return { messages: merged, droppedNewest }
}

/** Keep only the newest page when hydrating a conversation. */
export function takeNewestPage(
  messages: UIMessage[],
  pageSize: number = CHAT_PAGE_SIZE,
): UIMessage[] {
  if (messages.length <= pageSize) return messages
  return messages.slice(messages.length - pageSize)
}
