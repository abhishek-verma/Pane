/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * UI-only projection of chat transcripts. Clones messages for the sidepanel /
 * attach wire without mutating the agent transcript (accuracy invariant).
 */

import { AGENT_LIMITS } from '@browseros/shared/constants/limits'
import type { UIMessage } from 'ai'
import type { ToolOutputStore } from './session-store'

export type ProjectMessagesForUiOptions = {
  sessionId: string
  outputStore: ToolOutputStore
  /** Inline preview budget (agent transcript unchanged). */
  previewMaxChars?: number
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars; open details]`
}

/** Size estimate that never JSON.stringify's image `data` (LO spike). */
function estimateOutputBytes(value: unknown): number {
  if (value == null) return 0
  if (typeof value === 'string') return value.length
  if (typeof value !== 'object') return 8
  if (Array.isArray(value)) {
    let n = 0
    for (const item of value) n += estimateOutputBytes(item)
    return n
  }
  const rec = value as Record<string, unknown>
  if (rec.type === 'image' && typeof rec.data === 'string') {
    return rec.data.length + 32
  }
  let n = 0
  for (const [k, v] of Object.entries(rec)) {
    n += k.length
    if (k === 'data' && typeof v === 'string' && rec.type === 'image') {
      n += v.length
      continue
    }
    if (k === 'image' && typeof v === 'string') {
      n += v.length
      continue
    }
    n += estimateOutputBytes(v)
  }
  return n
}

function hasInlineImageData(rec: Record<string, unknown>): boolean {
  if (Array.isArray(rec.content)) {
    for (const item of rec.content) {
      if (
        item &&
        typeof item === 'object' &&
        (item as { type?: string }).type === 'image' &&
        typeof (item as { data?: unknown }).data === 'string' &&
        (item as { stripped?: boolean }).stripped !== true
      ) {
        return true
      }
    }
  }
  const sc = rec.structuredContent
  if (sc && typeof sc === 'object' && !Array.isArray(sc)) {
    const image = (sc as { image?: unknown }).image
    if (typeof image === 'string' && image.length > 0) return true
  }
  return false
}

/**
 * Project a single tool output value for the UI wire (SSE chunk or message
 * part). Spills fat bodies to ToolOutputStore. Does not mutate `output`.
 * Always strips inline image `data` from the UI clone.
 */
export function projectToolOutputForUi(
  output: unknown,
  options: {
    sessionId: string
    toolCallId: string
    outputStore: ToolOutputStore
    previewMaxChars?: number
  },
): { output: unknown; changed: boolean } {
  if (!output || typeof output !== 'object') {
    return { output, changed: false }
  }
  const maxChars =
    options.previewMaxChars ?? AGENT_LIMITS.UI_TOOL_OUTPUT_PREVIEW_MAX_CHARS
  const rec = output as Record<string, unknown>
  const hasImage = hasInlineImageData(rec)
  if (rec.spilled === true && typeof rec.preview === 'string' && !hasImage) {
    return { output, changed: false }
  }

  const bytes = estimateOutputBytes(output)
  const structured = rec.structuredContent
  const structuredRec =
    structured && typeof structured === 'object' && !Array.isArray(structured)
      ? (structured as Record<string, unknown>)
      : null
  const fatSnapshot =
    structuredRec &&
    typeof structuredRec.snapshot === 'string' &&
    structuredRec.snapshot.length > maxChars

  if (bytes <= maxChars * 2 && !fatSnapshot && !hasImage) {
    return { output, changed: false }
  }

  const needsSpill = bytes > maxChars * 2 || Boolean(fatSnapshot)
  const stored = needsSpill
    ? options.outputStore.store(
        options.sessionId,
        options.toolCallId,
        JSON.stringify(output),
        'application/json',
      )
    : false
  return {
    output: shrinkOutputForUi(rec, maxChars, stored),
    changed: true,
  }
}

/**
 * Clone `messages` for UI: spill oversized tool outputs to ToolOutputStore and
 * leave short previews + refs in the clone. Input array/objects are not mutated.
 */
export function projectMessagesForUi(
  messages: UIMessage[],
  options: ProjectMessagesForUiOptions,
): UIMessage[] {
  let anyChanged = false

  const next = messages.map((msg) => {
    let partsChanged = false
    const parts = msg.parts.map((part) => {
      if (typeof part.type !== 'string' || !part.type.startsWith('tool-')) {
        return part
      }
      const anyPart = part as Record<string, unknown>
      const toolCallId = anyPart.toolCallId
      const output = anyPart.output
      if (
        !output ||
        typeof output !== 'object' ||
        typeof toolCallId !== 'string'
      ) {
        return part
      }

      const projected = projectToolOutputForUi(output, {
        sessionId: options.sessionId,
        toolCallId,
        outputStore: options.outputStore,
        previewMaxChars: options.previewMaxChars,
      })
      if (!projected.changed) return part

      anyChanged = true
      partsChanged = true
      return {
        ...anyPart,
        output: projected.output,
      } as typeof part
    })

    if (!partsChanged) return msg
    return { ...msg, parts }
  })

  return anyChanged ? next : messages
}

function shrinkOutputForUi(
  rec: Record<string, unknown>,
  maxChars: number,
  spilled: boolean,
): Record<string, unknown> {
  const content = Array.isArray(rec.content) ? rec.content : null
  let preview = ''
  const nextContent: unknown[] = []

  if (content) {
    for (const item of content) {
      if (typeof item !== 'object' || item === null) {
        nextContent.push(item)
        continue
      }
      const block = item as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string') {
        if (!preview) preview = truncateText(block.text, maxChars)
        nextContent.push({
          ...block,
          text: truncateText(block.text, maxChars),
        })
        continue
      }
      // Keep stripped image placeholders for lazy tool-images UX.
      if (block.type === 'image') {
        const { data: _drop, ...rest } = block
        nextContent.push(
          rest.stripped === true ? rest : { ...rest, stripped: true },
        )
        continue
      }
      nextContent.push(item)
    }
  }

  let structuredContent = rec.structuredContent
  if (
    structuredContent &&
    typeof structuredContent === 'object' &&
    !Array.isArray(structuredContent)
  ) {
    const sc = { ...(structuredContent as Record<string, unknown>) }
    if (typeof sc.snapshot === 'string' && sc.snapshot.length > maxChars) {
      sc.snapshotPreview = truncateText(sc.snapshot, maxChars)
      sc.snapshotTruncated = true
      sc.snapshotContentLength = sc.snapshot.length
      delete sc.snapshot
    }
    // Never keep legacy inline image bytes in the UI clone.
    if (typeof sc.image === 'string') {
      delete sc.image
    }
    structuredContent = sc
  }

  if (!preview) {
    preview = truncateText(
      typeof content?.[0] === 'object' &&
        content[0] !== null &&
        typeof (content[0] as { text?: unknown }).text === 'string'
        ? String((content[0] as { text: string }).text)
        : '',
      maxChars,
    )
  }

  return {
    ...rec,
    content: nextContent.length > 0 ? nextContent : rec.content,
    structuredContent,
    spilled,
    preview,
    contentLength: estimateOutputBytes(rec),
  }
}
