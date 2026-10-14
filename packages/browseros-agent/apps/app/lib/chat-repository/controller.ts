import type { UIMessage } from 'ai'
import type { ChatTurnControllerListener } from '@/modules/chat/chat-turn-controller'
import type { ChatActiveTurnInfo } from '../conversations/chat-turn-api'
import { chatRepositoryClient } from './client'
import type { ChatSnapshot } from './types'

/** Compatibility adapter for view hooks. No polling, transport or execution
 * ownership lives here; it observes the profile-wide repository. */
export class RepositoryChatController {
  private id: string | null = null
  private state?: ChatSnapshot
  private release?: () => void
  private sink?: (messages: UIMessage[]) => void
  private listeners = new Set<ChatTurnControllerListener>()
  private notify() {
    for (const listener of this.listeners)
      listener({
        isTurnActive: this.isTurnActive,
        activeTurn: this.turn,
        activityKnown: this.hasResolvedActivity,
        activityError: this.state?.error ? new Error(this.state.error) : null,
      })
  }
  get messages() {
    return this.state?.loaded ? this.state.messages : undefined
  }
  get vmStatus() {
    return this.state?.vmStatus ?? null
  }
  get hasMore() {
    return this.state?.hasMore ?? false
  }
  get isTurnActive() {
    return this.state?.busy ?? false
  }
  get hasResolvedActivity() {
    return this.state?.activityKnown ?? false
  }
  get turn(): ChatActiveTurnInfo | null {
    return this.state?.active ?? null
  }
  setConversationId(id: string | null) {
    if (this.id === id) return
    this.release?.()
    this.release = undefined
    this.id = id
    this.state = undefined
    this.sink = undefined
    this.notify()
    if (id)
      this.release = chatRepositoryClient.subscribe(id, (state) => {
        this.state = state
        this.notify()
        if (state.loaded) this.sink?.(state.messages)
      })
  }
  subscribe(listener: ChatTurnControllerListener) {
    this.listeners.add(listener)
    this.notify()
    return () => {
      this.listeners.delete(listener)
    }
  }
  ensureAttached(sink: (messages: UIMessage[]) => void) {
    this.sink = sink
    if (this.state?.loaded) sink(this.state.messages)
  }
  attachToCurrent(sink: (messages: UIMessage[]) => void) {
    this.ensureAttached(sink)
  }
  detachAttachOnly() {
    this.sink = undefined
  }
  dispose() {
    this.release?.()
    this.release = undefined
    this.id = null
    this.sink = undefined
  }
  async refreshActive() {
    const id = this.id
    if (!id) return false
    const state = await chatRepositoryClient.request<ChatSnapshot>(
      'refresh',
      id,
    )
    if (this.id === id) {
      this.state = state
      this.notify()
    }
    return this.isTurnActive
  }
  noteStartedTurn(_turnId: string, _conversationId: string) {
    /* Receipt is already committed by the coordinator. */
  }
  markInactive() {
    /* Views cannot override authoritative execution state. */
  }
  async cancel(reason?: string) {
    return this.id
      ? chatRepositoryClient.request<boolean>('cancel', this.id, { reason })
      : false
  }
}
