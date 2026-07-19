/**
 * Agent UI stream response with message-level step/finish callbacks.
 *
 * `createAgentUIStreamResponse` only exposes ToolLoopAgent `onStepFinish`
 * (usage/tool metadata), not UIMessage lists. This helper routes the agent
 * chunk stream through `createUIMessageStream`, which calls
 * `handleUIMessageStreamFinish` with message-level `onStepFinish`/`onFinish`.
 */

import {
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageStreamOnFinishCallback,
  type UIMessageStreamOnStepFinishCallback,
} from 'ai'

export type DurableAgentUIStreamParams = {
  // biome-ignore lint/suspicious/noExplicitAny: Agent generics vary by tool set
  agent: any
  uiMessages: UIMessage[]
  abortSignal?: AbortSignal
  onStepFinish?: UIMessageStreamOnStepFinishCallback<UIMessage>
  onFinish?: UIMessageStreamOnFinishCallback<UIMessage>
  headers?: HeadersInit
  status?: number
  statusText?: string
  consumeSseStream?: (options: {
    stream: ReadableStream<string>
  }) => PromiseLike<void> | void
}

export async function createDurableAgentUIStreamResponse(
  params: DurableAgentUIStreamParams,
): Promise<Response> {
  const {
    agent,
    uiMessages,
    abortSignal,
    onStepFinish,
    onFinish,
    headers,
    status,
    statusText,
    consumeSseStream,
  } = params

  const stream = createUIMessageStream({
    originalMessages: uiMessages,
    onStepFinish,
    onFinish,
    execute: async ({ writer }) => {
      // Omit onFinish/onStepFinish so createAgentUIStream returns raw chunks;
      // createUIMessageStream owns message-level persistence callbacks.
      const agentStream = await createAgentUIStream({
        agent,
        uiMessages,
        abortSignal,
      })
      writer.merge(agentStream)
    },
  })

  return createUIMessageStreamResponse({
    headers,
    status,
    statusText,
    consumeSseStream,
    stream,
  })
}
