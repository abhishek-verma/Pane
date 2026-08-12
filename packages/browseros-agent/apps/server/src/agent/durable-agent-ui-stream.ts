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
  if (isNoSuchToolError(error)) {
    return 'The agent called a tool the chat runtime did not recognize. Send your message again to continue.'
  }
  const invalidInput = isInvalidToolInputError(error)
  if (invalidInput.match) {
    const tool = invalidInput.toolName ? ` (${invalidInput.toolName})` : ''
    return `The agent's last tool call${tool} had malformed input and could not be repaired automatically. Send your message again to continue.`
  }
  if (isBedrockExpiredCredentials(error)) {
    return 'AWS credentials have expired. Re-enter your Bedrock access key, secret, and session token in Settings → Providers.'
  }
  const message = findStreamErrorMessage(error)
  if (message) {
    if (isOpaqueStreamError(message) && isAcpxRuntimeError(error)) {
      return 'The agent runtime hit an internal error. Send your message again to continue.'
    }
    return truncateStreamErrorMessage(message)
  }
  return 'An error occurred.'
}

/**
 * ACPX sometimes returns JSON-RPC failures as plain objects rather than
 * Error instances. Walk both shapes so a useful adapter/server detail is not
 * discarded and replaced by the SDK's generic error text.
 */
function findStreamErrorMessage(error: unknown): string | null {
  const visited = new Set<unknown>()
  let fallback: string | null = null
  let current: unknown = error

  for (let depth = 0; depth < 8 && current != null; depth++) {
    if (typeof current === 'string') {
      const message = firstErrorLine(current)
      if (message && !isOpaqueStreamError(message)) return message
      fallback ??= message || null
      break
    }

    if (typeof current !== 'object' || visited.has(current)) break
    visited.add(current)

    const value = current as {
      message?: unknown
      error?: unknown
      detail?: unknown
      data?: unknown
      cause?: unknown
    }
    const message =
      typeof value.message === 'string' ? firstErrorLine(value.message) : ''
    if (message && !isOpaqueStreamError(message)) return message
    fallback ??= message || null

    // ACP JSON-RPC errors commonly keep the actionable detail in data or
    // error; ordinary SDK errors put it in cause.
    current = value.cause ?? value.data ?? value.error ?? value.detail
  }

  return fallback
}

function firstErrorLine(value: string): string {
  return value.split('\n')[0]?.trim() ?? ''
}

function isOpaqueStreamError(message: string): boolean {
  return message === 'An error occurred.' || message === 'Internal error'
}

/**
 * Bedrock signals an expired STS session token via the
 * `x-amzn-errortype: ExpiredTokenException` response header. Keyed
 * specifically on that header rather than "HTTP 400 with an empty body" —
 * Bedrock also returns an empty-body 400 for SerializationException (e.g. a
 * malformed request payload), which is a request-shape bug, not an expired
 * credential, and must not be shown or persisted as one.
 */
function isBedrockExpiredCredentials(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as {
    name?: unknown
    url?: unknown
    responseHeaders?: unknown
  }
  if (e.name !== 'AI_APICallError') return false
  if (typeof e.url !== 'string' || !e.url.includes('bedrock-runtime')) {
    return false
  }
  if (typeof e.responseHeaders !== 'object' || e.responseHeaders === null) {
    return false
  }
  const errorType = (e.responseHeaders as Record<string, unknown>)[
    'x-amzn-errortype'
  ]
  return (
    typeof errorType === 'string' &&
    errorType.startsWith('ExpiredTokenException')
  )
}

function truncateStreamErrorMessage(message: string): string {
  return message.length > 280 ? `${message.slice(0, 277)}...` : message
}

function describeStreamError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause
    const apiError = error as Error & {
      statusCode?: number
      responseBody?: string
      responseHeaders?: Record<string, string>
      url?: string
    }
    return {
      name: error.name,
      message: error.message,
      ...(apiError.statusCode != null && { statusCode: apiError.statusCode }),
      ...(apiError.responseBody != null && {
        responseBody: apiError.responseBody.slice(0, 1000),
      }),
      ...(apiError.responseHeaders?.['x-amzn-errortype'] != null && {
        awsErrorType: apiError.responseHeaders['x-amzn-errortype'],
      }),
      ...(apiError.url != null && { url: apiError.url }),
      cause:
        cause instanceof Error
          ? { name: cause.name, message: cause.message }
          : cause != null
            ? describeUnknownError(cause)
            : undefined,
    }
  }
  return { value: String(error).slice(0, 500) }
}

function describeUnknownError(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return String(value).slice(0, 500)
  }
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value).slice(0, 500)
  }
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

function isNoSuchToolError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  const message = (error as { message?: string }).message ?? ''
  return (
    name === 'AI_NoSuchToolError' ||
    name === 'NoSuchToolError' ||
    message.startsWith('Model tried to call unavailable tool')
  )
}

function isInvalidToolInputError(error: unknown): {
  match: boolean
  toolName?: string
} {
  if (!error || typeof error !== 'object') return { match: false }
  const name = (error as { name?: string }).name
  if (name !== 'AI_InvalidToolInputError' && name !== 'InvalidToolInputError') {
    return { match: false }
  }
  const toolName = (error as { toolName?: unknown }).toolName
  return {
    match: true,
    toolName: typeof toolName === 'string' ? toolName : undefined,
  }
}

function isAcpxRuntimeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  const cause = (error as { cause?: { code?: unknown } }).cause
  return (
    name === 'AcpxError' ||
    (typeof cause === 'object' &&
      cause !== null &&
      (cause as { code?: unknown }).code === 'RUNTIME')
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

  const text = input.errorText?.trim() || EMPTY_AGENT_FINISH_MESSAGE
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
      logger.warn('Agent UI stream error', {
        error: text,
        ...describeStreamError(error),
      })
      return text
    },
    execute: async ({ writer }) => {
      // Pass onError into createAgentUIStream → toUIMessageStream. Without
      // this, the SDK defaults to () => "An error occurred." and the real
      // provider/context error is lost before our outer onError sees it.
      const agentStream = await createAgentUIStream({
        agent,
        uiMessages,
        abortSignal,
        onError: (error: unknown) => {
          const text = formatAgentStreamError(error)
          lastStreamError = text
          logger.warn('Agent stream error (toUIMessageStream)', {
            error: text,
            ...describeStreamError(error),
          })
          return text
        },
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
