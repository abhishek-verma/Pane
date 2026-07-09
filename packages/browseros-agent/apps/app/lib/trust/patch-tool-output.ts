import type { UIMessage } from 'ai'
import type { ToolInvocationInfo } from '@/screens/sidepanel/index/getMessageSegments'

function extractReplayText(output: unknown): string {
  if (typeof output === 'string') return output
  if (output && typeof output === 'object') {
    if ('text' in output && typeof output.text === 'string') {
      return output.text
    }
    if ('content' in output && Array.isArray(output.content)) {
      return output.content
        .map((part) => {
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: string }).text ?? '')
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
  }
  return JSON.stringify(output, null, 2)
}

/** Patches a tool invocation's input before approving with edited args. */
export function patchToolInvocationInput(
  messages: UIMessage[],
  toolCallId: string,
  input: Record<string, unknown>,
): UIMessage[] {
  return messages.map((message) => {
    if (!message.parts?.length) return message

    let changed = false
    const parts = message.parts.map((part) => {
      if (!part.type?.startsWith('tool-') && part.type !== 'dynamic-tool') {
        return part
      }

      const toolPart = part as {
        toolCallId?: string
        input?: unknown
      }
      if (toolPart.toolCallId !== toolCallId) return part

      changed = true
      return { ...part, input }
    })

    return changed ? ({ ...message, parts } as UIMessage) : message
  })
}

/** Patches a tool invocation's output after a trust replay/promote. */
export function patchToolInvocationOutput(
  messages: UIMessage[],
  toolCallId: string,
  output: unknown,
  isError: boolean,
): UIMessage[] {
  return messages.map((message) => {
    if (!message.parts?.length) return message

    let changed = false
    const parts = message.parts.map((part) => {
      if (!part.type?.startsWith('tool-') && part.type !== 'dynamic-tool') {
        return part
      }

      const toolPart = part as {
        toolCallId?: string
        state?: string
        output?: unknown
      }
      if (toolPart.toolCallId !== toolCallId) return part

      changed = true
      return {
        ...part,
        state: isError ? 'output-error' : 'output-available',
        output,
      }
    })

    return changed ? ({ ...message, parts } as UIMessage) : message
  })
}

export function formatReplayOutputForTool(
  tool: Pick<ToolInvocationInfo, 'toolName'>,
  output: unknown,
): unknown {
  if (tool.toolName.startsWith('filesystem_')) {
    const text = extractReplayText(output)
    return {
      text,
      isError: Boolean((output as { isError?: boolean })?.isError),
    }
  }
  const text = extractReplayText(output)
  return {
    content: [{ type: 'text', text }],
    isError: Boolean((output as { isError?: boolean })?.isError),
  }
}
