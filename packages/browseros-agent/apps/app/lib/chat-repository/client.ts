import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import {
  CHAT_REPOSITORY_PORT,
  type ChatSnapshot,
  type PreparedChatRequest,
  type RunEvent,
  type RunResult,
} from './types'
import { sendRepositoryRequest } from './wire'

/** One bridge per UI realm; its state is a rendering replica, not an owner. */
class RepositoryClient {
  private port?: chrome.runtime.Port
  private epoch?: string
  private retry?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void
      reject: (error: Error) => void
      event?: (event: RunEvent) => void
    }
  >()
  private subscriptions = new Map<string, Set<(state: ChatSnapshot) => void>>()
  private states = new Map<string, ChatSnapshot>()
  private connect() {
    if (this.port) return this.port
    const port = chrome.runtime.connect({ name: CHAT_REPOSITORY_PORT })
    this.port = port
    let lastMessageAt = Date.now()
    port.onMessage.addListener((message) => {
      lastMessageAt = Date.now()
      if (message.epoch && message.epoch !== this.epoch) {
        this.epoch = message.epoch
        this.states.clear()
      }
      if (message.type === 'snapshot') {
        const state = message.state as ChatSnapshot
        port.postMessage({ type: 'ack', conversationId: state.conversationId })
        const previous = this.states.get(state.conversationId)
        if (previous && state.revision <= previous.revision) return
        this.states.set(state.conversationId, state)
        for (const callback of this.subscriptions.get(state.conversationId) ??
          [])
          callback(state)
      } else {
        const pending = this.pending.get(message.requestId)
        if (!pending) return
        if (message.type === 'event') pending.event?.(message.event)
        else {
          this.pending.delete(message.requestId)
          if (message.error) pending.reject(new Error(message.error))
          else pending.resolve(message.value)
        }
      }
    })
    const disconnected = () => {
      if (this.port !== port) return
      this.port = undefined
      if (this.heartbeat) clearInterval(this.heartbeat)
      this.states.clear() // A restarted owner starts a new revision epoch.
      for (const pending of this.pending.values())
        pending.reject(
          new Error(
            'Chat connection interrupted. Reconnecting; accepted messages will not be resent.',
          ),
        )
      this.pending.clear()
      if (this.subscriptions.size)
        this.retry = setTimeout(() => this.connect(), 500)
    }
    port.onDisconnect.addListener(disconnected)
    for (const id of this.subscriptions.keys())
      port.postMessage({
        type: 'subscribe',
        conversationId: id,
        visible: !document.hidden,
      })
    this.heartbeat = setInterval(() => {
      try {
        if (Date.now() - lastMessageAt >= 8000) {
          disconnected()
          port.disconnect()
          return
        }
        port.postMessage({
          type: 'ping',
          subscriptions: [...this.subscriptions.keys()].map(
            (conversationId) => ({ conversationId, visible: !document.hidden }),
          ),
        })
      } catch {
        disconnected()
      }
    }, 5000)
    return port
  }
  request<T>(
    method: string,
    conversationId: string,
    payload?: unknown,
    event?: (event: RunEvent) => void,
  ): Promise<T> {
    const requestId = crypto.randomUUID()
    const port = this.connect()
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, event })
      try {
        sendRepositoryRequest((message) => port.postMessage(message), {
          type: 'request',
          requestId,
          method,
          conversationId,
          payload,
        })
      } catch (error) {
        this.pending.delete(requestId)
        reject(error)
      }
    })
  }
  subscribe(id: string, callback: (state: ChatSnapshot) => void) {
    const port = this.connect()
    let listeners = this.subscriptions.get(id)
    if (!listeners) {
      listeners = new Set()
      this.subscriptions.set(id, listeners)
      port.postMessage({
        type: 'subscribe',
        conversationId: id,
        visible: !document.hidden,
      })
    }
    listeners.add(callback)
    const state = this.states.get(id)
    if (state) callback(state)
    const visibility = () =>
      this.port?.postMessage({
        type: 'visibility',
        conversationId: id,
        visible: !document.hidden,
      })
    document.addEventListener('visibilitychange', visibility)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      listeners.delete(callback)
      if (!listeners.size) {
        this.subscriptions.delete(id)
        this.states.delete(id)
        this.port?.postMessage({ type: 'unsubscribe', conversationId: id })
      }
      if (!this.subscriptions.size && !this.pending.size) {
        if (this.retry) clearTimeout(this.retry)
        if (this.heartbeat) clearInterval(this.heartbeat)
        const current = this.port
        this.port = undefined
        current?.disconnect()
      }
    }
  }
}
export const chatRepositoryClient = new RepositoryClient()
export const readRepositoryChat = (id: string) =>
  chatRepositoryClient.request<ChatSnapshot>('read', id)

export const readRepositoryPage = (
  id: string,
  options?: {
    beforeId?: string
    limit?: number
    baseUrl?: string
    signal?: AbortSignal
    allowMissing?: boolean
  },
) =>
  chatRepositoryClient.request<
    import('../conversations/server-chat-history').ChatMessagePage
  >('page', id, { beforeId: options?.beforeId })

export function repositoryTransport(
  prepare: (input: {
    messages: UIMessage[]
  }) => Promise<{ api: string; body: Record<string, unknown> }>,
  lifecycle: () => {
    accepted?: (receipt: {
      turnId: string
      conversationId: string
    }) => void | Promise<void>
    completed?: (result: RunResult) => void
  },
): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, chatId, abortSignal }) {
      abortSignal?.throwIfAborted()
      const callbacks = lifecycle()
      const prepared = await prepare({ messages })
      abortSignal?.throwIfAborted()
      const id = String(prepared.body.conversationId ?? chatId)
      const request: PreparedChatRequest = {
        path: new URL(prepared.api).pathname,
        body: prepared.body,
      }
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          let detached = false
          const onAbort = () => {
            detached = true
            try {
              controller.close()
            } catch {}
          }
          abortSignal?.addEventListener('abort', onAbort, { once: true })
          void chatRepositoryClient
            .request<RunResult>('run', id, { request, messages }, (event) => {
              if (detached) return
              if (event.type === 'accepted') void callbacks.accepted?.(event)
              else controller.enqueue(event.chunk)
            })
            .then(
              (result) => {
                callbacks.completed?.(result)
                if (!detached) controller.close()
              },
              (error) => {
                if (!detached) controller.error(error)
              },
            )
            .finally(() => abortSignal?.removeEventListener('abort', onAbort))
        },
      })
    },
    async reconnectToStream() {
      return null
    },
  }
}
