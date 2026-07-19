/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/** Extract plain text from a stored chat message content JSON blob. */
export function extractChatPlainText(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as unknown
    if (typeof parsed === 'string') return parsed.slice(0, 4000)
    if (Array.isArray(parsed)) {
      const parts: string[] = []
      for (const p of parsed) {
        if (
          p &&
          typeof p === 'object' &&
          'type' in p &&
          (p as { type: string }).type === 'text' &&
          'text' in p
        ) {
          parts.push(String((p as { text: string }).text))
        }
      }
      return parts.join('\n').slice(0, 4000)
    }
  } catch {
    return contentJson.slice(0, 4000)
  }
  return ''
}
