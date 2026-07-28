/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

function textFromParts(parts: unknown[]): string {
  const out: string[] = []
  for (const p of parts) {
    if (
      p &&
      typeof p === 'object' &&
      'type' in p &&
      (p as { type: string }).type === 'text' &&
      'text' in p
    ) {
      out.push(String((p as { text: string }).text))
    }
  }
  return out.join('\n').slice(0, 4000)
}

/** Extract plain text from a stored chat message content JSON blob. */
export function extractChatPlainText(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as unknown
    if (typeof parsed === 'string') return parsed.slice(0, 4000)
    if (Array.isArray(parsed)) return textFromParts(parsed)
    // Current persist shape: `{ id, parts }`. Also tolerate a full UIMessage.
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { parts?: unknown }).parts)
    ) {
      return textFromParts((parsed as { parts: unknown[] }).parts)
    }
  } catch {
    return contentJson.slice(0, 4000)
  }
  return ''
}
