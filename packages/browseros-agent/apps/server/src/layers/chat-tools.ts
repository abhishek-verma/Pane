import type { ToolSet } from 'ai'
import { tryGetProfileKey } from '../lib/profile-context'

const invocations = new Map<string, ToolSet>()
const completions = new Map<string, () => boolean>()
const key = (conversationId: string) =>
  JSON.stringify([tryGetProfileKey(), conversationId])

/** The same scoped tools enter both the SDK toolset and Pane's ACP MCP server.
 * Target identity is captured by the server; it is never a model argument. */
export function registerLayerChatTools(
  conversationId: string,
  tools: ToolSet,
  complete: () => boolean = () => false,
) {
  const id = key(conversationId)
  if (invocations.has(id)) throw new Error('Layer invocation already running.')
  const scoped: ToolSet = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: tool.execute
          ? async (...args: Parameters<NonNullable<typeof tool.execute>>) => {
              if (invocations.get(id) !== scoped)
                throw new Error('This Layer invocation has ended.')
              return tool.execute!(...args)
            }
          : undefined,
      },
    ]),
  )
  invocations.set(id, scoped)
  completions.set(id, complete)
  return () => {
    invocations.delete(id)
    completions.delete(id)
  }
}

export function getLayerChatTools(conversationId?: string): ToolSet {
  return conversationId ? (invocations.get(key(conversationId)) ?? {}) : {}
}

export function isLayerChatComplete(conversationId: string): boolean {
  return completions.get(key(conversationId))?.() ?? false
}
