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
import { logger } from '../lib/logger'
import { hasMessageContent } from './message-validation'

/** Shown when the model/stream ends with an empty assistant message. */
export const EMPTY_AGENT_FINISH_MESSAGE =
  'The agent stopped without a reply. Send another message to continue.'

/** User-facing stream error text (never leak raw SDK stack names). */
export function formatAgentStreamError(error: unknown): string {
  if (
    MissingToolResultsError.isInstance(error) ||
    isMissingToolResults(error)
  ) {
    return 'A tool call was interrupted or still waiting for approval. Approve or deny the pending action, or send your message again to continue.'
  }
  if (isTypeValidationError(error)) {
    return 'Chat history had an invalid tool approval state. Send your message again to continue.'
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

function isTypeValidationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  const message = (error as { message?: string }).message ?? ''
  return (
    name === 'AI_TypeValidationError' ||
    name === 'TypeValidationError' ||
    message.startsWith('Type validation failed')
  )
}

export type DurableAgentUIStreamParams = {
  // biome-ignore lint/suspicious/noExplicitAny: Agent generics vary by tool set
  agent: any
  uiMessages: UIMessage[]
  abortSignal?: AbortSignal
  conversationId?: string
  onStepFinish?: UIMessageStreamOnStepFinishCallback<UIMessage>
  onFinish?: UIMessageStreamOnFinishCallback<UIMessage>
  headers?: HeadersInit
  status?: number
  statusText?: string
  consumeSseStream?: (options: {
    stream: ReadableStream<string>
  }) => PromiseLike<void> | void
}

/**
 * If the stream finished without aborting but the assistant has no parts,
 * inject a short user-visible error so filterValidMessages cannot drop it
 * and leave "continue" as a silent no-op.
 */
export function ensureNonEmptyAssistantFinish(input: {
  messages: UIMessage[]
  responseMessage: UIMessage
  isAborted: boolean
  errorText?: string | null
  finishReason?: string
  conversationId?: string
}): { messages: UIMessage[]; responseMessage: UIMessage; filled: boolean } {
  if (input.isAborted || hasMessageContent(input.responseMessage)) {
    return {
      messages: input.messages,
      responseMessage: input.responseMessage,
      filled: false,
    }
  }

  const text =
    (input.errorText && input.errorText.trim()) || EMPTY_AGENT_FINISH_MESSAGE
  const filledMessage: UIMessage = {
    ...input.responseMessage,
    parts: [{ type: 'text', text }],
  }
  logger.warn('Empty agent finish; persisting recovery message', {
    conversationId: input.conversationId,
    finishReason: input.finishReason,
    responseMessageId: input.responseMessage.id,
    usedStreamError: Boolean(input.errorText?.trim()),
  })

  const idx = input.messages.findIndex((m) => m.id === filledMessage.id)
  const messages =
    idx >= 0
      ? input.messages.map((m, i) => (i === idx ? filledMessage : m))
      : [...input.messages, filledMessage]

  return { messages, responseMessage: filledMessage, filled: true }
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

  let lastStreamError: string | null = null

  const stream = createUIMessageStream({
    originalMessages: uiMessages,
    onStepFinish,
    onFinish: onFinish
      ? async (event) => {
          const ensured = ensureNonEmptyAssistantFinish({
            messages: event.messages,
            responseMessage: event.responseMessage,
            isAborted: event.isAborted,
            errorText: lastStreamError,
            finishReason: event.finishReason,
            conversationId: params.conversationId,
          })
          await onFinish({
            ...event,
            messages: ensured.messages,
            responseMessage: ensured.responseMessage,
          })
        }
      : undefined,
    onError: (error) => {
      const text = formatAgentStreamError(error)
      lastStreamError = text
      logger.warn('Agent UI stream error', { error: text })
      return text
    },
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
