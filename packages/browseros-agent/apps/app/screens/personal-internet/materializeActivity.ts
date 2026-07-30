/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Derive rolling activity lines + approval hints from a materialize chat turn.
 */

export type MaterializeActivityLine = {
  kind: 'text' | 'tool' | 'reasoning'
  text: string
}

export type MaterializeActivitySnapshot = {
  lines: MaterializeActivityLine[]
  /** True when the latest tool part is waiting (input-available, no output). */
  toolWaiting: boolean
  lastToolName: string | null
}

type UiPart = {
  type?: string
  text?: string
  state?: string
  input?: unknown
  toolName?: string
}

type UiMessage = {
  role?: string
  parts?: UiPart[]
}

function toolNameFromPart(part: UiPart): string | null {
  if (typeof part.toolName === 'string' && part.toolName) return part.toolName
  const t = part.type ?? ''
  if (t.startsWith('tool-')) return t.slice('tool-'.length)
  return null
}

function summarizeTool(name: string, input: unknown): string {
  if (name === 'skills_load') {
    const id =
      input && typeof input === 'object' && 'id' in input
        ? String((input as { id?: unknown }).id ?? '')
        : ''
    return id ? `Loaded skill ${id}` : 'Loading skill…'
  }
  if (name === 'pi_read') return 'Reading page…'
  if (name === 'pi_page_patch') return 'Updating page…'
  if (name === 'pi_entity_ensure') return 'Ensuring company page…'
  return `Using ${name}`
}

function clip(text: string, max = 120): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function appendPartLine(
  lines: MaterializeActivityLine[],
  part: UiPart,
  waiting: { toolWaiting: boolean; lastToolName: string | null },
): void {
  const type = part.type ?? ''
  if (type === 'reasoning' && part.text?.trim()) {
    lines.push({ kind: 'reasoning', text: clip(part.text) })
    return
  }
  if (type === 'text' && part.text?.trim()) {
    lines.push({ kind: 'text', text: clip(part.text) })
    return
  }
  if (!type.startsWith('tool-') && type !== 'dynamic-tool') return

  const name = toolNameFromPart(part) ?? 'tool'
  waiting.lastToolName = name
  const state = part.state ?? ''
  if (state === 'input-available' || state === 'approval-requested') {
    waiting.toolWaiting = true
    lines.push({
      kind: 'tool',
      text: `Waiting: ${summarizeTool(name, part.input)}`,
    })
    return
  }
  if (state === 'output-available' || state === 'output-error') {
    waiting.toolWaiting = false
  }
  lines.push({ kind: 'tool', text: summarizeTool(name, part.input) })
}

/** Build up to `limit` newest activity lines from assistant UI messages. */
export function deriveMaterializeActivity(
  messages: unknown[],
  limit = 4,
): MaterializeActivitySnapshot {
  const lines: MaterializeActivityLine[] = []
  const waiting = { toolWaiting: false, lastToolName: null as string | null }

  for (const raw of messages) {
    const msg = raw as UiMessage
    if (msg.role !== 'assistant' || !Array.isArray(msg.parts)) continue
    for (const part of msg.parts) {
      appendPartLine(lines, part, waiting)
    }
  }

  return {
    lines: lines.slice(-limit),
    toolWaiting: waiting.toolWaiting,
    lastToolName: waiting.lastToolName,
  }
}
