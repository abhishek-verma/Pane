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
  MissingToolResultsError,
  type UIMessage,
  type UIMessageStreamOnFinishCallback,
  type UIMessageStreamOnStepFinishCallback,
} from 'ai'

/** User-facing stream error text (never leak raw SDK stack names). */
export function formatAgentStreamError(error: unknown): string {
  if (
    MissingToolResultsError.isInstance(error) ||
    isMissingToolResults(error)
  ) {
    return 'A tool was still waiting for approval when the next message was sent. Approve or deny the pending action, or send your message again.'
  }
  if (error instanceof Error && error.message.trim()) {
    // Keep short; avoid dumping multi-line SDK stacks into the chat UI.
    const firstLine = error.message.split('\n')[0]?.trim() ?? ''
    return firstLine.length > 280 ? `${firstLine.slice(0, 277)}...` : firstLine
  }
  return 'An error occurred.'
}

function isMissingToolResults(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  const message = (error as { message?: string }).message ?? ''
  return (
    name === 'AI_MissingToolResultsError' ||
    name === 'MissingToolResultsError' ||
    message.includes('Tool result is missing for tool call')
  )
}

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
    onError: formatAgentStreamError,
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
