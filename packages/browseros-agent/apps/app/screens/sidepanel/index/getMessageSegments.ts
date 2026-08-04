/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { UIMessage } from 'ai'
import { PI_HREF_RE } from '@/lib/personal-internet/pi-href'
import { bareToolName } from '@/lib/tool-name'
import type { PiPagePreview } from './PiPageCard'

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
  | { type: 'text'; key: string; text: string; isStreaming: boolean }
  | { type: 'reasoning'; key: string; text: string; isStreaming: boolean }
  | { type: 'tool-batch'; key: string; tools: ToolInvocationInfo[] }
  | { type: 'nudge'; key: string; nudgeType: NudgeType; data: NudgeData }
  | {
      type: 'pi-preview'
      key: string
      href: string
      preview?: PiPagePreview | null
      autoOpen?: boolean
    }

const NUDGE_TOOLS = new Set(['suggest_schedule', 'suggest_app_connection'])

/** Tools whose success payload surfaces a PI page card (hide generic row). */
const PI_CARD_TOOLS = new Set([
  'pi_open',
  'pi_site_upsert',
  'pi_page_create',
  'pi_entity_ensure',
  'pi_preserve_temp',
])

function toolOutputText(output: unknown): string | null {
  try {
    const result = output as {
      content?: Array<{ type: string; text?: string }>
      isError?: boolean
      text?: string
    }
    if (result?.isError) return null
    if (typeof result?.text === 'string') return result.text
    const text = result?.content?.find((c) => c.type === 'text')?.text
    return text ?? null
  } catch {
    return null
  }
}

function parseNudgeOutput(output: unknown): NudgeData | null {
  try {
    const text = toolOutputText(output)
    if (!text) return null
    const parsed = JSON.parse(text)
    if (
      parsed?.type === 'schedule_suggestion' ||
      parsed?.type === 'app_connection'
    ) {
      return parsed as NudgeData
    }
  } catch {
    // ignore
  }
  return null
}

function parsePiCardOutput(
  output: unknown,
  toolName: string,
): { href: string; preview?: PiPagePreview | null; autoOpen: boolean } | null {
  try {
    const text = toolOutputText(output)
    if (!text) return null
    const parsed = JSON.parse(text) as {
      href?: string
      piOpenRoute?: string
      preview?: PiPagePreview
      navigate?: boolean
      type?: string
    }
    const href =
      (typeof parsed.href === 'string' && parsed.href.startsWith('pi://')
        ? parsed.href
        : null) ??
      (typeof parsed.piOpenRoute === 'string' &&
      parsed.piOpenRoute.startsWith('pi://')
        ? parsed.piOpenRoute
        : null)
    if (!href) return null
    return {
      href,
      preview: parsed.preview ?? null,
      autoOpen: toolName === 'pi_open' || parsed.navigate === true,
    }
  } catch {
    return null
  }
}

function pushTextWithPiLinks(
  segments: MessageSegment[],
  messageId: string,
  text: string,
  isStreaming: boolean,
  textIndex: { n: number },
  piIndex: { n: number },
  seenHrefs: Set<string>,
): void {
  PI_HREF_RE.lastIndex = 0
  let last = 0
  let found = false
  let match: RegExpExecArray | null = PI_HREF_RE.exec(text)
  while (match) {
    found = true
    const before = text.slice(last, match.index)
    if (before) {
      segments.push({
        type: 'text',
        key: `${messageId}-text-${textIndex.n++}`,
        text: before,
        isStreaming: false,
      })
    }
    const href = match[0].replace(/[.,;:!?`*_|\\]+$/, '')
    if (!seenHrefs.has(href)) {
      seenHrefs.add(href)
      segments.push({
        type: 'pi-preview',
        key: `${messageId}-pi-${piIndex.n++}`,
        href,
      })
    }
    last = match.index + match[0].length
    match = PI_HREF_RE.exec(text)
  }
  const rest = text.slice(last)
  if (rest || !found) {
    segments.push({
      type: 'text',
      key: `${messageId}-text-${textIndex.n++}`,
      text: found ? rest : text,
      isStreaming,
    })
  }
}

export const getMessageSegments = (
  message: UIMessage,
  isLastMessage: boolean,
  isStreaming: boolean,
): MessageSegment[] => {
  const segments: MessageSegment[] = []
  let currentToolBatch: ToolInvocationInfo[] = []
  let reasoningSegmentCount = 0
  const textIndex = { n: 0 }
  const piIndex = { n: 0 }
  const seenToolCallIds = new Set<string>()
  const seenReasoningTexts = new Set<string>()
  const seenPiHrefs = new Set<string>()
  // Tracks which `segments` index holds the pi-preview card for a given
  // href so a later tool call for the same page (e.g. pi_open after
  // pi_page_create) can upgrade autoOpen instead of being silently dropped
  // as a duplicate.
  const piCardIndexByHref = new Map<string, number>()

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
      const streaming =
        isStreaming && i === message.parts.length - 1 && isLastMessage
      if (streaming || !PI_HREF_RE.test(part.text)) {
        PI_HREF_RE.lastIndex = 0
        segments.push({
          type: 'text',
          key: `${message.id}-text-${textIndex.n++}`,
          text: part.text,
          isStreaming: streaming,
        })
      } else {
        PI_HREF_RE.lastIndex = 0
        pushTextWithPiLinks(
          segments,
          message.id,
          part.text,
          false,
          textIndex,
          piIndex,
          seenPiHrefs,
        )
      }
    } else if (part.type === 'reasoning') {
      flushToolBatch()
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
      if (toolPart.toolCallId?.startsWith('acpx-')) {
        continue
      }
      const toolName = bareToolName(
        part.type === 'dynamic-tool'
          ? (toolPart.toolName ?? 'tool')
          : toolPart.type.replace('tool-', ''),
      )

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
      } else if (
        PI_CARD_TOOLS.has(toolName) &&
        toolPart.state === 'output-available'
      ) {
        flushToolBatch()
        const card = parsePiCardOutput(toolPart.output, toolName)
        if (card) {
          const existingIdx = piCardIndexByHref.get(card.href)
          const existing =
            existingIdx !== undefined ? segments[existingIdx] : undefined
          if (existing?.type === 'pi-preview') {
            // e.g. pi_page_create's own card arrived first (no autoOpen);
            // a later pi_open for the same href must still trigger navigation.
            if (card.autoOpen && !existing.autoOpen) {
              segments[existingIdx as number] = {
                ...existing,
                preview: card.preview ?? existing.preview,
                autoOpen: true,
              }
            }
          } else {
            seenPiHrefs.add(card.href)
            piCardIndexByHref.set(card.href, segments.length)
            segments.push({
              type: 'pi-preview',
              key: `${message.id}-pi-${toolPart.toolCallId}`,
              href: card.href,
              preview: card.preview,
              autoOpen: card.autoOpen,
            })
          }
        }
      } else if (NUDGE_TOOLS.has(toolName) || PI_CARD_TOOLS.has(toolName)) {
      } else if (!NUDGE_TOOLS.has(toolName)) {
        const nextTool: ToolInvocationInfo = {
          state: toolPart.state,
          toolCallId: toolPart.toolCallId,
          toolName,
          input: toolPart?.input ?? {},
          output: toolPart?.output ?? null,
          approval: toolPart?.approval,
        }
        if (seenToolCallIds.has(toolPart.toolCallId)) {
          const existingIdx = currentToolBatch.findIndex(
            (t) => t.toolCallId === toolPart.toolCallId,
          )
          if (existingIdx >= 0) {
            currentToolBatch[existingIdx] = nextTool
            continue
          }
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
