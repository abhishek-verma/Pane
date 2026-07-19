/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * In-process pub/sub for capture SSE delivery.
 */

import type {
  CaptureSessionStatus,
  TranscriptSegment,
} from '@browseros/capture/types'

export type CaptureStreamEvent =
  | { type: 'segment'; segment: TranscriptSegment; cursor?: number }
  | {
      type: 'status'
      sessionId: string
      status: CaptureSessionStatus | string
      asrDeferred?: boolean
      modelStatus?: string
      appearsMuted?: boolean
      catchUp?: boolean
    }
  | { type: 'gap'; segment: TranscriptSegment }
  | { type: 'heartbeat'; ts: number }

type Listener = (event: CaptureStreamEvent & { cursor: number }) => void

const listeners = new Map<string, Set<Listener>>()
const cursors = new Map<string, number>()

export function publishCaptureEvent(
  sessionId: string,
  event: CaptureStreamEvent,
): void {
  const cursor = (cursors.get(sessionId) ?? 0) + 1
  cursors.set(sessionId, cursor)
  const payload = { ...event, cursor }
  const set = listeners.get(sessionId)
  if (!set) return
  for (const listener of set) {
    try {
      listener(payload)
    } catch {
      /* ignore broken listeners */
    }
  }
}

export function subscribeCaptureEvents(
  sessionId: string,
  listener: Listener,
): () => void {
  let set = listeners.get(sessionId)
  if (!set) {
    set = new Set()
    listeners.set(sessionId, set)
  }
  set.add(listener)
  return () => {
    set!.delete(listener)
    if (set!.size === 0) listeners.delete(sessionId)
  }
}

export function getCaptureEventCursor(sessionId: string): number {
  return cursors.get(sessionId) ?? 0
}
