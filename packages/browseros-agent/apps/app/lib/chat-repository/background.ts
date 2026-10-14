import type { UIMessage } from 'ai'
import {
  type ChatMessagePage,
  fetchChatMessagePage,
} from '../conversations/server-chat-history'
import { submitRepositoryApproval } from './approvals'
import { repositoryBackend } from './backend'
import { startRepositoryQueue } from './queue'
import { ChatRepository } from './repository'
import {
  CHAT_REPOSITORY_PORT,
  type ChatSnapshot,
  type PreparedChatRequest,
  type RunEvent,
} from './types'
import { RepositoryRequestChunks } from './wire'

export function startChatRepository() {
  const epoch = crypto.randomUUID()
  const repository = new ChatRepository(repositoryBackend)
  const queue = startRepositoryQueue(repository)
  const pages = new Map<string, Promise<ChatMessagePage>>()
  chrome.runtime.onConnect.addListener((port) => {
    // Content scripts share the extension ID but are not allowed to send chat
    // commands or read transcripts. Only our own extension UI may connect.
    if (
      port.name !== CHAT_REPOSITORY_PORT ||
      port.sender?.id !== chrome.runtime.id ||
      !port.sender.url?.startsWith(chrome.runtime.getURL(''))
    )
      return
    const subscriptions = new Map<
      string,
      ReturnType<ChatRepository['subscribe']>
    >()
    const chunks = new RepositoryRequestChunks()
    const awaiting = new Set<string>()
    const latest = new Map<string, ChatSnapshot>()
    let disconnected = false
    const post = (value: unknown) => {
      if (!disconnected)
        try {
          port.postMessage({ ...(value as object), epoch })
        } catch {}
    }
    const send = (state: ChatSnapshot) => {
      if (awaiting.has(state.conversationId)) {
        latest.set(state.conversationId, state)
        return
      }
      awaiting.add(state.conversationId)
      post({ type: 'snapshot', state })
    }
    post({ type: 'hello' })
    const receive = (message: any) => {
      if (
        message.type === 'request-chunk' ||
        message.type === 'request-complete'
      ) {
        try {
          const assembled = chunks.accept(message)
          if (assembled) receive(assembled)
        } catch (error) {
          post({
            type: 'result',
            requestId: message.requestId,
            error: String(error),
          })
        }
        return
      }
      const id = message.conversationId
      if (message.type === 'ping') {
        for (const item of message.subscriptions ?? []) {
          if (
            typeof item.conversationId === 'string' &&
            item.conversationId.length <= 256 &&
            !subscriptions.has(item.conversationId)
          )
            subscriptions.set(
              item.conversationId,
              repository.subscribe(
                item.conversationId,
                send,
                item.visible === true,
              ),
            )
        }
        post({ type: 'pong' })
        return
      }
      if (typeof id !== 'string' || !id || id.length > 256) return
      if (message.type === 'ack') {
        awaiting.delete(id)
        const next = latest.get(id)
        latest.delete(id)
        if (next) send(next)
      } else if (message.type === 'subscribe') {
        subscriptions.get(id)?.dispose()
        subscriptions.set(
          id,
          repository.subscribe(id, send, message.visible === true),
        )
      } else if (message.type === 'visibility')
        subscriptions.get(id)?.visibility(message.visible === true)
      else if (message.type === 'unsubscribe') {
        subscriptions.get(id)?.dispose()
        subscriptions.delete(id)
        latest.delete(id)
        awaiting.delete(id)
      } else if (message.type === 'request') {
        const event = (event: RunEvent) =>
          post({ type: 'event', requestId: message.requestId, event })
        const execute = async () => {
          switch (message.method) {
            case 'read':
              return repository.read(id)
            case 'page': {
              const beforeId = message.payload?.beforeId
              if (typeof beforeId !== 'string' || !beforeId)
                return repository.reload(id)
              const key = JSON.stringify([id, beforeId])
              let pending = pages.get(key)
              if (!pending) {
                pending = fetchChatMessagePage(id, {
                  beforeId,
                  limit: 60,
                }).finally(() => pages.delete(key))
                pages.set(key, pending)
              }
              return pending
            }
            case 'refresh':
              await repository.refresh(id)
              return repository.peek(id)
            case 'cancel':
              return repository.cancel(id, message.payload?.reason)
            case 'approve':
              return submitRepositoryApproval(
                repository,
                id,
                message.payload.decision,
                message.payload.request,
              )
            case 'run':
              return repository.run(
                id,
                message.payload.request as PreparedChatRequest,
                message.payload.messages as UIMessage[],
                event,
              )
            case 'queue':
              await queue.kick(id)
              return true
            default:
              throw new Error('Unknown chat repository command')
          }
        }
        void execute().then(
          (value) =>
            post({ type: 'result', requestId: message.requestId, value }),
          (error) =>
            post({
              type: 'result',
              requestId: message.requestId,
              error: error instanceof Error ? error.message : String(error),
            }),
        )
      }
    }
    port.onMessage.addListener(receive)
    port.onDisconnect.addListener(() => {
      disconnected = true
      chunks.dispose()
      for (const subscription of subscriptions.values()) subscription.dispose()
      subscriptions.clear()
      latest.clear()
    })
  })
  const tick = () => {
    repository.tick()
    void queue.scan().catch(() => {})
  }
  setInterval(tick, 2000)
  // A worker restart must discover durable pending work even with no UI open.
  chrome.alarms.create('pane-chat-repository', { periodInMinutes: 1 })
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'pane-chat-repository') tick()
  })
  void queue.scan().catch(() => {})
  return repository
}
