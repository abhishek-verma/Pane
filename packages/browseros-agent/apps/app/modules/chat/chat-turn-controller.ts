/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Sole owner of sidepanel chat turn liveness for the UI: attach/detach/cancel
 * and isTurnActive. useChat.stop() only detaches the POST subscriber.
 */

import type { UIMessage } from 'ai'
import {
  attachChatTurnStream,
  type ChatActiveTurnInfo,
  cancelChatTurn,
  fetchActiveChatTurn,
} from '@/lib/conversations/chat-turn-api'

export type ChatTurnControllerListener = (state: {
  isTurnActive: boolean
  activeTurn: ChatActiveTurnInfo | null
}) => void

export class ChatTurnController {
  private activeTurn: ChatActiveTurnInfo | null = null
  private attachAbort: AbortController | null = null
  private lastSeq = -1
  private lastEmittedActive = false
  private lastEmittedTurnId: string | null = null
  /** Last attach snapshot seq applied to the UI (dedupe identical frames). */
  private lastAppliedSeq = Number.NEGATIVE_INFINITY
  private listeners = new Set<ChatTurnControllerListener>()
  private conversationId: string | null = null

  get isTurnActive(): boolean {
    return this.activeTurn?.status === 'running'
  }

  get turn(): ChatActiveTurnInfo | null {
    return this.activeTurn
  }

  subscribe(listener: ChatTurnControllerListener): () => void {
    this.listeners.add(listener)
    listener({ isTurnActive: this.isTurnActive, activeTurn: this.activeTurn })
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const isTurnActive = this.isTurnActive
    const turnId = this.activeTurn?.turnId ?? null
    if (
      isTurnActive === this.lastEmittedActive &&
      turnId === this.lastEmittedTurnId
    ) {
      return
    }
    this.lastEmittedActive = isTurnActive
    this.lastEmittedTurnId = turnId
    const snapshot = {
      isTurnActive,
      activeTurn: this.activeTurn,
    }
    for (const listener of this.listeners) listener(snapshot)
  }

  setConversationId(conversationId: string | null): void {
    if (this.conversationId === conversationId) return
    this.detachAttachOnly()
    this.conversationId = conversationId
    this.activeTurn = null
    this.lastSeq = -1
    this.lastAppliedSeq = Number.NEGATIVE_INFINITY
    this.emit()
  }

  /** Called when POST /chat returns X-Turn-Id (starter still streaming). */
  noteStartedTurn(turnId: string, conversationId: string): void {
    // Abort any prior attach (e.g. approval-resume after restore/reattach).
    this.detachAttachOnly()
    this.conversationId = conversationId
    this.activeTurn = {
      turnId,
      conversationId,
      status: 'running',
      lastSeq: -1,
      startedAt: Date.now(),
      prompt: null,
      truncated: false,
    }
    this.lastSeq = -1
    this.lastAppliedSeq = Number.NEGATIVE_INFINITY
    this.emit()
  }

  /** Local detach only — does not cancel the server turn. */
  detachAttachOnly(): void {
    this.attachAbort?.abort()
    this.attachAbort = null
  }

  /** Stop button / glow / voice / supersede. */
  async cancel(reason?: string): Promise<boolean> {
    const conversationId = this.conversationId
    const turnIdAtStart = this.activeTurn?.turnId ?? null
    this.detachAttachOnly()
    if (!conversationId) {
      this.activeTurn = null
      this.lastSeq = -1
      this.lastAppliedSeq = Number.NEGATIVE_INFINITY
      this.emit()
      return false
    }
    const { cancelled } = await cancelChatTurn(conversationId, { reason })
    // A newer noteStartedTurn (supersede → send) must not be wiped by this
    // cancel's completion. Same if the user already switched conversations.
    if (this.conversationId !== conversationId) return cancelled
    if (
      this.activeTurn != null &&
      turnIdAtStart != null &&
      this.activeTurn.turnId !== turnIdAtStart
    ) {
      return cancelled
    }
    this.activeTurn = null
    this.lastSeq = -1
    this.lastAppliedSeq = Number.NEGATIVE_INFINITY
    this.emit()
    return cancelled
  }

  markInactive(): void {
    this.detachAttachOnly()
    this.activeTurn = null
    this.lastSeq = -1
    this.lastAppliedSeq = Number.NEGATIVE_INFINITY
    this.emit()
  }

  /**
   * Discover + attach. Applies snapshots via onMessages.
   * Returns whether a live turn was found.
   */
  async restoreAndAttach(input: {
    conversationId: string
    onMessages: (messages: UIMessage[]) => void
  }): Promise<boolean> {
    this.setConversationId(input.conversationId)
    const active = await fetchActiveChatTurn(input.conversationId)
    if (this.conversationId !== input.conversationId) return false
    if (active?.status !== 'running') {
      this.activeTurn = null
      this.emit()
      return false
    }
    this.activeTurn = active
    this.lastSeq = active.lastSeq
    this.emit()
    this.beginAttach(input.onMessages)
    return true
  }

  /** Re-attach after switch-back when we already know the turn is running. */
  attachToCurrent(onMessages: (messages: UIMessage[]) => void): void {
    if (this.activeTurn?.status !== 'running') return
    this.beginAttach(onMessages)
  }

  private beginAttach(onMessages: (messages: UIMessage[]) => void): void {
    const conversationId = this.conversationId
    const turn = this.activeTurn
    if (!conversationId || !turn) return

    this.detachAttachOnly()
    const ac = new AbortController()
    this.attachAbort = ac
    const attachedTurnId = turn.turnId

    // Coalesce rapid step snapshots to one apply per animation frame so
    // setMessages cannot nest with React render work (max update depth).
    // Dedupe by seq only — content fingerprints miss tool-state-only updates.
    let pending: { messages: UIMessage[]; seq: number } | null = null
    let rafId: number | null = null
    const stillCurrent = () =>
      !ac.signal.aborted &&
      this.attachAbort === ac &&
      this.conversationId === conversationId &&
      this.activeTurn?.turnId === attachedTurnId

    const applySnapshot = (messages: UIMessage[], seq: number) => {
      if (!stillCurrent()) return
      if (seq >= 0 && seq <= this.lastAppliedSeq) return
      if (seq >= 0) this.lastAppliedSeq = seq
      onMessages(messages)
    }
    const flush = () => {
      rafId = null
      if (!pending || !stillCurrent()) return
      const next = pending
      pending = null
      applySnapshot(next.messages, next.seq)
    }
    const queueSnapshot = (messages: UIMessage[], seq: number) => {
      pending = { messages, seq }
      if (rafId != null) return
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(flush)
      } else {
        flush()
      }
    }

    void attachChatTurnStream({
      conversationId,
      turnId: turn.turnId,
      lastSeq: this.lastSeq >= 0 ? this.lastSeq : undefined,
      signal: ac.signal,
      onEvent: async (event, seq) => {
        if (!stillCurrent()) return
        if (seq >= 0) this.lastSeq = seq
        if (event.type === 'snapshot') {
          queueSnapshot(event.messages, seq)
        } else if (event.type === 'done') {
          if (rafId != null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          if (pending) {
            const next = pending
            pending = null
            applySnapshot(next.messages, next.seq)
          }
          if (!stillCurrent()) return
          this.activeTurn = null
          this.lastAppliedSeq = Number.NEGATIVE_INFINITY
          this.emit()
        }
      },
    })
      .catch(() => {
        // Attach failed; keep activeTurn until next poll/restore if still running.
      })
      .finally(() => {
        if (rafId != null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        // Stream ended without a done frame (drop) — still apply latest snapshot.
        if (pending && stillCurrent()) {
          const next = pending
          pending = null
          applySnapshot(next.messages, next.seq)
        }
        if (this.attachAbort === ac) this.attachAbort = null
      })
  }

  /**
   * Poll /active while UI thinks it might still be running.
   * On probe failure, keep the prior liveness (do not false-unstick).
   */
  async refreshActive(): Promise<boolean> {
    const conversationId = this.conversationId
    if (!conversationId) return false
    try {
      const active = await fetchActiveChatTurn(conversationId)
      // User may have switched chats while the probe was in flight.
      if (this.conversationId !== conversationId) return false
      if (active?.status !== 'running') {
        this.activeTurn = null
        this.emit()
        return false
      }
      this.activeTurn = active
      // emit() no-ops when turnId + isTurnActive are unchanged (watchdog poll).
      this.emit()
      return true
    } catch {
      return this.conversationId === conversationId && this.isTurnActive
    }
  }
}
