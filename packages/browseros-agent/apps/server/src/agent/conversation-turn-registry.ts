/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Process-local registry for sidepanel ChatService turns. Decouples turn
 * lifetime from any one HTTP SSE subscriber (same contract as harness
 * TurnRegistry, keyed by conversationId, frames are message snapshots).
 */

import { randomUUID } from 'node:crypto'
import type { UIMessage } from 'ai'
import { logger } from '../lib/logger'

export type ChatTurnRunStatus = 'running' | 'done' | 'error' | 'cancelled'

export type ChatTurnFrameEvent =
  | { type: 'snapshot'; messages: UIMessage[] }
  | { type: 'done'; status: Exclude<ChatTurnRunStatus, 'running'> }

export interface ChatTurnFrame {
  seq: number
  event: ChatTurnFrameEvent
  createdAt: number
}

export interface ChatTurnInfo {
  turnId: string
  conversationId: string
  status: ChatTurnRunStatus
  lastSeq: number
  startedAt: number
  endedAt?: number
  prompt: string | null
  truncated: boolean
}

interface Subscriber {
  push(frame: ChatTurnFrame): void
  end(): void
}

class SnapshotRingBuffer {
  private readonly frames: ChatTurnFrame[] = []
  private readonly capacity: number
  private nextSeq = 0
  private terminal: ChatTurnFrame | null = null
  truncated = false
  /** Latest snapshot for cold attach when the ring was truncated. */
  latestSnapshot: UIMessage[] | null = null

  constructor(capacity = 500) {
    this.capacity = capacity
  }

  push(event: ChatTurnFrameEvent): ChatTurnFrame {
    const frame: ChatTurnFrame = {
      seq: this.nextSeq++,
      event,
      createdAt: Date.now(),
    }
    if (event.type === 'snapshot') {
      this.latestSnapshot = event.messages
    }
    if (event.type === 'done') {
      this.terminal = frame
    }
    this.frames.push(frame)
    if (this.frames.length > this.capacity) {
      this.frames.shift()
      this.truncated = true
    }
    return frame
  }

  slice(fromSeq: number): ChatTurnFrame[] {
    const live = this.frames.filter((f) => f.seq > fromSeq)
    if (this.terminal && !live.some((f) => f.seq === this.terminal?.seq)) {
      if (this.terminal.seq > fromSeq) live.push(this.terminal)
    }
    return live
  }

  get lastSeq(): number {
    return this.nextSeq - 1
  }
}

export interface ActiveChatTurn {
  turnId: string
  conversationId: string
  status: ChatTurnRunStatus
  buffer: SnapshotRingBuffer
  subscribers: Set<Subscriber>
  abortController: AbortController
  startedAt: number
  endedAt?: number
  retainUntil?: number
  prompt: string | null
}

const DEFAULT_RETAIN_AFTER_DONE_MS = 5 * 60 * 1000
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000

export class ConversationTurnRegistry {
  private readonly turns = new Map<string, ActiveChatTurn>()
  private readonly byConversation = new Map<string, string>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  register(
    conversationId: string,
    options: { prompt?: string | null } = {},
  ): ActiveChatTurn {
    const existingId = this.byConversation.get(conversationId)
    if (existingId) {
      const existing = this.turns.get(existingId)
      if (existing?.status === 'running') {
        throw new ConversationTurnAlreadyActiveError(
          existing.turnId,
          conversationId,
        )
      }
    }

    const turn: ActiveChatTurn = {
      turnId: randomUUID(),
      conversationId,
      status: 'running',
      buffer: new SnapshotRingBuffer(),
      subscribers: new Set(),
      abortController: new AbortController(),
      startedAt: Date.now(),
      prompt: options.prompt ?? null,
    }
    this.turns.set(turn.turnId, turn)
    this.byConversation.set(conversationId, turn.turnId)
    this.ensureSweeper()
    return turn
  }

  get(turnId: string): ActiveChatTurn | undefined {
    return this.turns.get(turnId)
  }

  getActiveFor(conversationId: string): ActiveChatTurn | undefined {
    const turnId = this.byConversation.get(conversationId)
    if (!turnId) return undefined
    const turn = this.turns.get(turnId)
    if (!turn || turn.status !== 'running') return undefined
    return turn
  }

  describe(turnId: string): ChatTurnInfo | null {
    const turn = this.turns.get(turnId)
    if (!turn) return null
    return {
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      status: turn.status,
      lastSeq: turn.buffer.lastSeq,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      prompt: turn.prompt,
      truncated: turn.buffer.truncated,
    }
  }

  pushSnapshot(turnId: string, messages: UIMessage[]): ChatTurnFrame | null {
    const turn = this.turns.get(turnId)
    if (!turn || turn.status !== 'running') return null
    const frame = turn.buffer.push({ type: 'snapshot', messages })
    this.fanout(turn, frame)
    return frame
  }

  complete(
    turnId: string,
    status: Exclude<ChatTurnRunStatus, 'running'>,
  ): void {
    const turn = this.turns.get(turnId)
    if (!turn || turn.status !== 'running') return
    const frame = turn.buffer.push({ type: 'done', status })
    this.markTerminal(turn, status)
    this.fanout(turn, frame)
    for (const sub of turn.subscribers) {
      try {
        sub.end()
      } catch {
        // ignore
      }
    }
    turn.subscribers.clear()
  }

  cancel(turnId: string, reason?: string): boolean {
    const turn = this.turns.get(turnId)
    if (!turn || turn.status !== 'running') return false
    try {
      turn.abortController.abort(reason ?? 'cancelled')
    } catch {
      // ignore
    }
    this.complete(turnId, 'cancelled')
    return true
  }

  cancelActiveFor(conversationId: string, reason?: string): boolean {
    const turn = this.getActiveFor(conversationId)
    if (!turn) return false
    return this.cancel(turn.turnId, reason)
  }

  /**
   * Subscribe from `fromSeq` (exclusive). When the buffer was truncated past
   * fromSeq, the first frame is a synthetic snapshot from `latestSnapshot`
   * (caller may also pass `fallbackMessages`).
   */
  subscribe(
    turnId: string,
    options: {
      fromSeq?: number
      signal?: AbortSignal
      fallbackMessages?: UIMessage[]
    } = {},
  ): ReadableStream<ChatTurnFrame> | null {
    const turn = this.turns.get(turnId)
    if (!turn) return null
    const fromSeq = options.fromSeq ?? -1

    let queueResolve: ((frame: ChatTurnFrame | null) => void) | null = null
    const pending: ChatTurnFrame[] = []

    const subscriber: Subscriber = {
      push(frame) {
        if (queueResolve) {
          const resolve = queueResolve
          queueResolve = null
          resolve(frame)
        } else {
          pending.push(frame)
        }
      },
      end() {
        if (queueResolve) {
          const resolve = queueResolve
          queueResolve = null
          resolve(null)
        } else {
          pending.push(null as unknown as ChatTurnFrame)
        }
      },
    }

    const needColdSnapshot =
      fromSeq < 0 ||
      turn.buffer.truncated ||
      (turn.buffer.lastSeq >= 0 &&
        fromSeq < turn.buffer.lastSeq - turn.buffer.slice(fromSeq).length)

    const initial: ChatTurnFrame[] = []
    if (needColdSnapshot) {
      const messages =
        turn.buffer.latestSnapshot ?? options.fallbackMessages ?? null
      if (messages) {
        initial.push({
          seq: Math.max(turn.buffer.lastSeq, 0),
          event: { type: 'snapshot', messages },
          createdAt: Date.now(),
        })
      }
    }
    initial.push(...turn.buffer.slice(fromSeq))

    turn.subscribers.add(subscriber)

    const signal = options.signal
    const onAbort = () => {
      turn.subscribers.delete(subscriber)
      subscriber.end()
    }
    if (signal?.aborted) {
      onAbort()
    } else {
      signal?.addEventListener('abort', onAbort, { once: true })
    }

    let initialIdx = 0
    return new ReadableStream<ChatTurnFrame>({
      pull: async (controller) => {
        if (initialIdx < initial.length) {
          controller.enqueue(initial[initialIdx++]!)
          return
        }
        if (turn.status !== 'running' && pending.length === 0) {
          controller.close()
          turn.subscribers.delete(subscriber)
          signal?.removeEventListener('abort', onAbort)
          return
        }
        const next =
          pending.shift() ??
          (await new Promise<ChatTurnFrame | null>((resolve) => {
            queueResolve = resolve
          }))
        if (next == null || (next as unknown) === null) {
          controller.close()
          turn.subscribers.delete(subscriber)
          signal?.removeEventListener('abort', onAbort)
          return
        }
        controller.enqueue(next)
        if (next.event.type === 'done') {
          controller.close()
          turn.subscribers.delete(subscriber)
          signal?.removeEventListener('abort', onAbort)
        }
      },
      cancel: () => {
        turn.subscribers.delete(subscriber)
        signal?.removeEventListener('abort', onAbort)
      },
    })
  }

  private fanout(turn: ActiveChatTurn, frame: ChatTurnFrame): void {
    for (const sub of turn.subscribers) {
      try {
        sub.push(frame)
      } catch (err) {
        logger.warn('Chat turn subscriber push failed', {
          turnId: turn.turnId,
          error: err instanceof Error ? err.message : String(err),
        })
        turn.subscribers.delete(sub)
      }
    }
  }

  private markTerminal(
    turn: ActiveChatTurn,
    status: Exclude<ChatTurnRunStatus, 'running'>,
  ): void {
    turn.status = status
    turn.endedAt = Date.now()
    turn.retainUntil = Date.now() + DEFAULT_RETAIN_AFTER_DONE_MS
    if (this.byConversation.get(turn.conversationId) === turn.turnId) {
      // Keep mapping until sweep so describe/attach still works during retain.
    }
  }

  private ensureSweeper(): void {
    if (this.sweepTimer) return
    this.sweepTimer = setInterval(() => this.sweep(), DEFAULT_SWEEP_INTERVAL_MS)
    this.sweepTimer.unref?.()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [turnId, turn] of this.turns) {
      if (turn.status === 'running') continue
      if (turn.retainUntil != null && turn.retainUntil > now) continue
      this.turns.delete(turnId)
      if (this.byConversation.get(turn.conversationId) === turnId) {
        this.byConversation.delete(turn.conversationId)
      }
    }
    if (this.turns.size === 0 && this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }
}

export class ConversationTurnAlreadyActiveError extends Error {
  readonly turnId: string
  readonly conversationId: string
  constructor(turnId: string, conversationId: string) {
    super(`Turn already active for conversation ${conversationId}`)
    this.name = 'ConversationTurnAlreadyActiveError'
    this.turnId = turnId
    this.conversationId = conversationId
  }
}

/** Shared process-local registry for ChatService. */
export const conversationTurnRegistry = new ConversationTurnRegistry()
