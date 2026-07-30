/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Slim AI SDK UI SSE bytes for the HTTP client branch so fat tool outputs
 * never enter the extension renderer. Background tee / onFinish keep full
 * fidelity via in-memory message callbacks (not this transform).
 */

import { projectToolOutputForUi } from './project-messages-for-ui'
import type { ToolOutputStore } from './session-store'

export type SlimUiSseOptions = {
  sessionId: string
  outputStore: ToolOutputStore
}

/**
 * TransformStream over SSE bytes. Rewrites `tool-output-available` (and
 * similar) data lines to spilled previews when outputs are large.
 */
export function createSlimUiSseTransform(
  options: SlimUiSseOptions,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true })
      while (true) {
        const sep = pending.indexOf('\n\n')
        if (sep < 0) break
        const event = pending.slice(0, sep)
        pending = pending.slice(sep + 2)
        controller.enqueue(
          encoder.encode(`${slimSseEvent(event, options)}\n\n`),
        )
      }
    },
    flush(controller) {
      pending += decoder.decode()
      if (pending.length > 0) {
        controller.enqueue(encoder.encode(slimSseEvent(pending, options)))
      }
    },
  })
}

/** Pure helper for tests — slim one SSE event block (no trailing \\n\\n). */
export function slimSseEvent(event: string, options: SlimUiSseOptions): string {
  const lines = event.split('\n')
  return lines
    .map((line) => {
      if (!line.startsWith('data:')) return line
      const raw = line.slice(5).trimStart()
      if (!raw || raw === '[DONE]') return line
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return line
      }
      if (!parsed || typeof parsed !== 'object') return line
      const slimmed = slimUiChunk(parsed as Record<string, unknown>, options)
      if (slimmed === parsed) return line
      return `data: ${JSON.stringify(slimmed)}`
    })
    .join('\n')
}

function slimUiChunk(
  chunk: Record<string, unknown>,
  options: SlimUiSseOptions,
): Record<string, unknown> {
  const type = chunk.type
  if (type !== 'tool-output-available') return chunk

  const toolCallId = chunk.toolCallId
  const output = chunk.output
  if (typeof toolCallId !== 'string' || output == null) return chunk

  const projected = projectToolOutputForUi(output, {
    sessionId: options.sessionId,
    toolCallId,
    outputStore: options.outputStore,
  })
  if (!projected.changed) return chunk
  return { ...chunk, output: projected.output }
}
