import type { UIMessage } from 'ai'

/** A revision forks immediately before the edited user turn. Nothing later is replayed. */
export function revisionPrefix(
  source: UIMessage[],
  messageId: string,
): UIMessage[] {
  const index = source.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )
  if (index < 0)
    throw new Error(
      'The message to revise was not found. Reload the original conversation.',
    )
  return structuredClone(source.slice(0, index))
}
