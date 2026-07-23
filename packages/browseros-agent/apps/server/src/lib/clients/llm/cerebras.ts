/**
 * Cerebras chat-completions accepts assistant reasoning history in `reasoning`,
 * while `@ai-sdk/openai-compatible` serializes reasoning parts as
 * `reasoning_content`. Echoing the latter back causes HTTP 400 on every
 * follow-up turn and every multi-step tool loop after the first tool result.
 *
 * Mirrors the transform in `@ai-sdk/cerebras` (vercel/ai#15416).
 */
export function transformCerebrasRequestBody(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const messages = args.messages
  if (!Array.isArray(messages)) return args

  return {
    ...args,
    messages: messages.map((message) => {
      if (
        message == null ||
        typeof message !== 'object' ||
        !('role' in message) ||
        (message as { role?: unknown }).role !== 'assistant' ||
        !('reasoning_content' in message)
      ) {
        return message
      }

      const { reasoning_content, ...rest } = message as Record<string, unknown>

      return {
        ...rest,
        ...(!('reasoning' in rest) && reasoning_content !== undefined
          ? { reasoning: reasoning_content }
          : {}),
      }
    }),
  }
}
