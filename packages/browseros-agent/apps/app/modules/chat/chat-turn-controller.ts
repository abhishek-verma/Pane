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
    const snapshot = {
      isTurnActive: this.isTurnActive,
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
    this.emit()
  }

  /** Called when POST /chat returns X-Turn-Id (starter still streaming). */
  noteStartedTurn(turnId: string, conversationId: string): void {
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
    this.detachAttachOnly()
    if (!conversationId) {
      this.activeTurn = null
      this.emit()
      return false
    }
    const { cancelled } = await cancelChatTurn(conversationId, { reason })
    this.activeTurn = null
    this.lastSeq = -1
    this.emit()
    return cancelled
  }

  markInactive(): void {
    this.detachAttachOnly()
    this.activeTurn = null
    this.lastSeq = -1
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

    void attachChatTurnStream({
      conversationId,
      turnId: turn.turnId,
      lastSeq: this.lastSeq >= 0 ? this.lastSeq : undefined,
      signal: ac.signal,
      onEvent: async (event, seq) => {
        if (seq >= 0) this.lastSeq = seq
        if (event.type === 'snapshot') {
          onMessages(event.messages)
        } else if (event.type === 'done') {
          this.activeTurn = null
          this.emit()
        }
      },
    })
      .catch(() => {
        // Attach failed; keep activeTurn until next poll/restore if still running.
      })
      .finally(() => {
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
      if (active?.status !== 'running') {
        this.activeTurn = null
        this.emit()
        return false
      }
      this.activeTurn = active
      this.emit()
      return true
    } catch {
      return this.isTurnActive
    }
  }
}
