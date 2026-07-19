import type { UIMessage } from 'ai'

export type ToolInvocationState =
  | 'partial-call'
  | 'call'
  | 'result'
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-denied'

export interface ToolInvocationInfo {
  state: ToolInvocationState
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  output: unknown
  approval?: { id: string; approved?: boolean; reason?: string }
}

export type NudgeType = 'schedule_suggestion' | 'app_connection'

export interface NudgeData {
  type: NudgeType
  [key: string]: unknown
}

export type MessageSegment =
  | { type: 'text'; key: string; text: string }
  | { type: 'reasoning'; key: string; text: string; isStreaming: boolean }
  | { type: 'tool-batch'; key: string; tools: ToolInvocationInfo[] }
  | { type: 'nudge'; key: string; nudgeType: NudgeType; data: NudgeData }

const NUDGE_TOOLS = new Set(['suggest_schedule', 'suggest_app_connection'])

function parseNudgeOutput(output: unknown): NudgeData | null {
  try {
    // output is { content: [{ type: "text", text: "JSON..." }], isError: false }
    const result = output as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
    }
    if (result?.isError) return null

    const text = result?.content?.find((c) => c.type === 'text')?.text
    if (!text) return null

    const parsed = JSON.parse(text)
    if (
      parsed?.type === 'schedule_suggestion' ||
      parsed?.type === 'app_connection'
    ) {
      return parsed as NudgeData
    }
  } catch {
    // ignore parse errors
  }
  return null
}

export const getMessageSegments = (
  message: UIMessage,
  isLastMessage: boolean,
  isStreaming: boolean,
): MessageSegment[] => {
  const segments: MessageSegment[] = []
  let currentToolBatch: ToolInvocationInfo[] = []
  let textSegmentCount = 0
  let reasoningSegmentCount = 0
  const seenToolCallIds = new Set<string>()
  const seenReasoningTexts = new Set<string>()

  const flushToolBatch = () => {
    if (currentToolBatch.length > 0) {
      segments.push({
        type: 'tool-batch',
        key: `${message.id}-tools-${currentToolBatch[0].toolCallId}`,
        tools: [...currentToolBatch],
      })
      currentToolBatch = []
    }
  }

  for (let i = 0; i < message.parts.length; i++) {
    const part = message.parts[i]

    if (part.type === 'text') {
      flushToolBatch()
      segments.push({
        type: 'text',
        key: `${message.id}-text-${textSegmentCount}`,
        text: part.text,
      })
      textSegmentCount++
    } else if (part.type === 'reasoning') {
      flushToolBatch()
      // Approval resume can re-emit the same reasoning block; keep the first.
      const reasoningKey = part.text.trim()
      if (reasoningKey && seenReasoningTexts.has(reasoningKey)) {
        continue
      }
      if (reasoningKey) seenReasoningTexts.add(reasoningKey)
      segments.push({
        type: 'reasoning',
        key: `${message.id}-reasoning-${reasoningSegmentCount}`,
        text: part.text,
        isStreaming:
          isStreaming && i === message.parts.length - 1 && isLastMessage,
      })
      reasoningSegmentCount++
    } else if (part.type?.startsWith('tool-') || part.type === 'dynamic-tool') {
      const toolPart = part as {
        toolCallId: string
        type: string
        toolName?: string
        state: ToolInvocationState
        input: Record<string, unknown>
        output: unknown
        approval?: { id: string; approved?: boolean; reason?: string }
      }
      // Phantom acpx-ai-provider tool-input-* stream emitted under a fresh
      // blockId ("acpx-N") that never reconciles with the real tool-call
      // id. The translator emits a paired dynamic-tool part with the real
      // id and full input + output, so dropping the phantom keeps the UI
      // honest until upstream fixes the id mismatch.
      // See: https://github.com/DaniAkash/acpx/issues/37
      if (toolPart.toolCallId?.startsWith('acpx-')) {
        continue
      }
      const toolName =
        part.type === 'dynamic-tool'
          ? (toolPart.toolName ?? 'tool')
          : toolPart.type.replace('tool-', '')

      if (NUDGE_TOOLS.has(toolName) && toolPart.state === 'output-available') {
        flushToolBatch()
        const nudgeData = parseNudgeOutput(toolPart.output)
        if (nudgeData) {
          segments.push({
            type: 'nudge',
            key: `${message.id}-nudge-${toolPart.toolCallId}`,
            nudgeType: nudgeData.type,
            data: nudgeData,
          })
        }
      } else if (!NUDGE_TOOLS.has(toolName)) {
        const nextTool: ToolInvocationInfo = {
          state: toolPart.state,
          toolCallId: toolPart.toolCallId,
          toolName,
          input: toolPart?.input ?? {},
          output: toolPart?.output ?? null,
          approval: toolPart?.approval,
        }
        // Prefer the latest part for a given toolCallId (e.g. approval-requested
        // then output-available after resume) so the UI shows one card.
        if (seenToolCallIds.has(toolPart.toolCallId)) {
          const existingIdx = currentToolBatch.findIndex(
            (t) => t.toolCallId === toolPart.toolCallId,
          )
          if (existingIdx >= 0) {
            currentToolBatch[existingIdx] = nextTool
            continue
          }
          // Already flushed in an earlier batch — upgrade that card in place.
          for (const segment of segments) {
            if (segment.type !== 'tool-batch') continue
            const idx = segment.tools.findIndex(
              (t) => t.toolCallId === toolPart.toolCallId,
            )
            if (idx >= 0) {
              segment.tools[idx] = nextTool
              break
            }
          }
          continue
        }
        seenToolCallIds.add(toolPart.toolCallId)
        currentToolBatch.push(nextTool)
      }
    }
  }

  flushToolBatch()

  return segments
}
