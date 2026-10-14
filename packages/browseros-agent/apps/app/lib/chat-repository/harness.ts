import { DefaultChatTransport, readUIMessageStream, type UIMessage } from 'ai'
import type { HarnessAgentHistoryPage } from '@/modules/agents/agent-harness-types'
import { agentFetch } from '../browseros/agent-fetch'
import { getAgentServerUrl } from '../browseros/helpers'
import { withRequestDeadline } from '../browseros/request-deadline'
import type {
  ChatActiveTurnInfo,
  ChatTurnStreamEvent,
} from '../conversations/chat-turn-api'
import type { PreparedChatRequest } from './types'

interface HarnessBinding {
  agentId: string
  sessionId: string
}
const key = (id: string) => `chat-harness-binding-v1:${id}`

// Persist before POST so accepted receipts remain routable after worker eviction.
export async function bindHarnessConversation(
  id: string,
  request: PreparedChatRequest,
) {
  const match = /^\/agents\/([^/]+)\/sidepanel\/chat$/.exec(request.path)
  const previous = await harnessBinding(id)
  if (match) {
    const binding: HarnessBinding = {
      agentId: decodeURIComponent(match[1]),
      sessionId: String(request.body.agentSessionId ?? id),
    }
    if (
      previous?.agentId !== binding.agentId ||
      previous.sessionId !== binding.sessionId
    )
      await chrome.storage.local.set({ [key(id)]: binding })
  } else if (request.path === '/chat') {
    if (previous) await chrome.storage.local.remove(key(id))
  } else throw new Error('Unsupported chat endpoint')
}
export async function harnessBinding(
  id: string,
): Promise<HarnessBinding | undefined> {
  return (await chrome.storage.local.get(key(id)))[key(id)] as
    | HarnessBinding
    | undefined
}
const sessionPath = (binding: HarnessBinding) =>
  `/agents/${encodeURIComponent(binding.agentId)}/sessions/${encodeURIComponent(binding.sessionId)}`
async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return withRequestDeadline(async (signal) => {
    const response = await agentFetch((await getAgentServerUrl()) + path, {
      ...init,
      signal,
    })
    if (!response.ok)
      throw new Error(`Harness request failed (${response.status})`)
    return response.json() as Promise<T>
  })
}
export async function harnessActive(
  id: string,
  binding: HarnessBinding,
): Promise<ChatActiveTurnInfo | null> {
  const { active } = await json<{ active: ChatActiveTurnInfo | null }>(
    sessionPath(binding) + '/chat/active',
  )
  return active ? { ...active, conversationId: id, truncated: false } : null
}
export async function harnessCancel(binding: HarnessBinding, reason?: string) {
  return (
    await json<{ cancelled: boolean }>(sessionPath(binding) + '/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
  ).cancelled
}
export async function harnessHistory(binding: HarnessBinding) {
  const page = await json<HarnessAgentHistoryPage>(
    sessionPath(binding) + '/history',
  )
  const messages: UIMessage[] = page.items.map((item) => ({
    id: item.id,
    role: item.role,
    parts: [
      ...(item.reasoning?.text
        ? [
            {
              type: 'reasoning' as const,
              text: item.reasoning.text,
              state: 'done' as const,
            },
          ]
        : []),
      ...(item.toolCalls ?? []).map((tool) => ({
        type: 'dynamic-tool' as const,
        toolCallId: tool.toolCallId ?? `${item.id}:${tool.toolName}`,
        toolName: tool.toolName,
        input: tool.input,
        ...(tool.status === 'failed'
          ? {
              state: 'output-error' as const,
              errorText: tool.error ?? 'Tool failed',
            }
          : tool.status === 'completed'
            ? { state: 'output-available' as const, output: tool.output }
            : { state: 'input-available' as const }),
      })),
      ...(item.text ? [{ type: 'text' as const, text: item.text }] : []),
    ],
  }))
  return { messages, hasMore: false }
}
export async function harnessAttach(
  id: string,
  binding: HarnessBinding,
  turnId: string,
  signal: AbortSignal,
  onEvent: (event: ChatTurnStreamEvent, seq: number) => void,
) {
  const base = await getAgentServerUrl()
  const url = `${base}${sessionPath(binding)}/chat/stream?format=ui&turnId=${encodeURIComponent(turnId)}`
  const transport = new DefaultChatTransport<UIMessage>({
    api: url,
    fetch: ((_input: RequestInfo | URL, init?: RequestInit) =>
      agentFetch(url, { method: 'GET', signal: init?.signal })) as typeof fetch,
  })
  // The registry replays this turn from its first frame; keep only earlier
  // persisted turns, never append the replay to a partially received assistant.
  const history = await harnessHistory(binding).catch(() => ({
    messages: [] as UIMessage[],
    hasMore: false,
  }))
  const active = await harnessActive(id, binding).catch(() => null)
  const previous = [...history.messages]
  const lastUser = previous.findLastIndex((message) => message.role === 'user')
  const lastPrompt = previous[lastUser]?.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
  if (
    active?.turnId === turnId &&
    active.prompt &&
    lastPrompt !== active.prompt
  ) {
    previous.push({
      id: `harness-user:${turnId}`,
      role: 'user',
      parts: [{ type: 'text', text: active.prompt }],
    })
  } else if (lastUser >= 0) {
    previous.splice(lastUser + 1)
  }

  const chunks = await transport.sendMessages({
    trigger: 'submit-message',
    chatId: id,
    messages: [],
    messageId: undefined,
    abortSignal: signal,
  })
  let seq = 0
  let terminal: 'done' | 'error' | 'cancelled' | undefined
  const observed = chunks.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === 'start' && !chunk.messageId)
          chunk = { ...chunk, messageId: `harness-assistant:${turnId}` }
        if (chunk.type === 'finish')
          terminal = chunk.finishReason === 'stop' ? 'done' : 'error'
        if (chunk.type === 'error') terminal = 'error'
        controller.enqueue(chunk)
        if (chunk.type === 'finish') controller.terminate()
      },
    }),
  )
  try {
    for await (const message of readUIMessageStream({
      stream: observed,
      terminateOnError: true,
    }))
      onEvent({ type: 'snapshot', messages: [...previous, message] }, ++seq)
  } catch (error) {
    if (!terminal) throw error
  }
  if (terminal) {
    // History preserves server message IDs across attach/reopen.
    const final = await harnessHistory(binding).catch(() => undefined)
    if (final?.messages.length)
      onEvent({ type: 'snapshot', messages: final.messages }, ++seq)
    onEvent({ type: 'done', status: terminal }, ++seq)
  }
}
