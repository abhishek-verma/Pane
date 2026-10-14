import {
  DefaultChatTransport,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from 'ai'
import { agentFetch } from '../browseros/agent-fetch'
import { getAgentServerUrl } from '../browseros/helpers'
import { withRequestDeadline } from '../browseros/request-deadline'
import {
  attachChatTurnStream,
  cancelChatTurn,
  fetchActiveChatTurn,
} from '../conversations/chat-turn-api'
import { fetchChatMessagePage } from '../conversations/server-chat-history'
import { slimMessagesForClientUi } from '../tool-evidence/slim-messages-for-client-ui'
import { stripFatInlineImagesFromMessages } from '../tool-evidence/strip-inline-images'
import { restoreApprovalDecisions } from './approvals'
import {
  bindHarnessConversation,
  harnessActive,
  harnessAttach,
  harnessBinding,
  harnessCancel,
  harnessHistory,
} from './harness'
import type { RepositoryBackend } from './repository'
import type { RunResult } from './types'

export const repositoryBackend: RepositoryBackend = {
  configure: bindHarnessConversation,
  history: async (id, allowMissing) => {
    const binding = await harnessBinding(id)
    if (binding) return harnessHistory(binding)
    const page = await fetchChatMessagePage(id, { limit: 60, allowMissing })
    return {
      ...page,
      messages: await restoreApprovalDecisions(id, page.messages),
    }
  },
  active: async (id) => {
    const binding = await harnessBinding(id)
    return binding ? harnessActive(id, binding) : fetchActiveChatTurn(id)
  },
  attach: async (id, turnId, signal, onEvent) => {
    const binding = await harnessBinding(id)
    return binding
      ? harnessAttach(id, binding, turnId, signal, onEvent)
      : attachChatTurnStream({ conversationId: id, turnId, signal, onEvent })
  },
  cancel: async (id, reason) => {
    const binding = await harnessBinding(id)
    if (binding) return harnessCancel(binding, reason)
    return withRequestDeadline(
      async (signal) =>
        (await cancelChatTurn(id, { reason, signal })).cancelled,
    )
  },
  project: (messages) =>
    slimMessagesForClientUi(stripFatInlineImagesFromMessages(messages)),
  async execute(id, request, messages, signal, event, snapshot) {
    if (!/^\/chat$|^\/agents\/[^/]+\/sidepanel\/chat$/.test(request.path))
      throw new Error('Unsupported chat endpoint')
    await bindHarnessConversation(id, request)
    const binding = await harnessBinding(id)
    const base = await getAgentServerUrl()
    let started: RunResult['started']
    let finishReason: string | undefined
    const transport = new DefaultChatTransport<UIMessage>({
      api: base + request.path,
      prepareSendMessagesRequest: () => ({
        body: { ...request.body, conversationId: id },
      }),
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await agentFetch(input, init)
        const turnId = response.headers.get('X-Turn-Id')
        if (turnId) {
          started = { turnId, conversationId: id }
          await event({ type: 'accepted', ...started })
        }
        return response
      }) as typeof fetch,
    })
    const decoderAbort = new AbortController()
    let probing = false
    const watchdog = setInterval(() => {
      if (!started || probing || decoderAbort.signal.aborted) return
      probing = true
      void repositoryBackend
        .active(id)
        .then((active) => {
          if (!active || active.turnId !== started?.turnId) decoderAbort.abort()
        })
        .catch(() => {})
        .finally(() => {
          probing = false
        })
    }, 2000)
    try {
      const chunks = await transport.sendMessages({
        trigger: 'submit-message',
        chatId: id,
        messageId: undefined,
        messages,
        abortSignal: AbortSignal.any([signal, decoderAbort.signal]),
      })
      const observed = chunks.pipeThrough(
        new TransformStream<UIMessageChunk, UIMessageChunk>({
          async transform(chunk, controller) {
            if (
              binding &&
              started &&
              chunk.type === 'start' &&
              !chunk.messageId
            )
              chunk = {
                ...chunk,
                messageId: `harness-assistant:${started.turnId}`,
              }
            if (chunk.type === 'finish') finishReason = chunk.finishReason
            if (chunk.type === 'error') finishReason = 'error'
            await event({ type: 'chunk', chunk })
            controller.enqueue(chunk)
            if (chunk.type === 'finish') controller.terminate()
          },
        }),
      )
      const last = messages.at(-1)
      const previous =
        last?.role === 'assistant' ? messages.slice(0, -1) : messages
      try {
        for await (const message of readUIMessageStream({
          message: last?.role === 'assistant' ? last : undefined,
          stream: observed,
          terminateOnError: true,
        }))
          snapshot([...previous, message])
      } catch (error) {
        if (!started) throw error
      }

      if (binding && finishReason)
        return { outcome: finishReason === 'stop' ? 'done' : 'paused', started }
      if (started) {
        let outcome: RunResult['outcome'] = 'pending'
        try {
          await repositoryBackend.attach(
            id,
            started.turnId,
            AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
            (value) => {
              if (value.type === 'snapshot') snapshot(value.messages)
              else outcome = value.status === 'done' ? 'done' : 'paused'
            },
          )
        } catch {
          return { outcome: 'pending', started }
        }
        return { outcome, started }
      }
      return { outcome: finishReason === 'stop' ? 'done' : 'paused' }
    } finally {
      clearInterval(watchdog)
    }
  },
}
