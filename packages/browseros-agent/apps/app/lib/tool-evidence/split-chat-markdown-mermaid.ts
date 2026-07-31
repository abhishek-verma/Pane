/**
 * Split assistant markdown so fenced ```mermaid blocks render via the
 * disposable sandbox iframe instead of Streamdown's Mermaid plugin.
 */

export type ChatMarkdownPart =
  | { type: 'markdown'; text: string }
  | { type: 'mermaid'; source: string }

const MERMAID_FENCE_RE = /```mermaid[ \t]*\r?\n([\s\S]*?)```/gi

export function splitChatMarkdownMermaid(text: string): ChatMarkdownPart[] {
  if (!text) return []
  const parts: ChatMarkdownPart[] = []
  let lastIndex = 0
  MERMAID_FENCE_RE.lastIndex = 0
  let match = MERMAID_FENCE_RE.exec(text)
  while (match) {
    const before = text.slice(lastIndex, match.index)
    if (before) parts.push({ type: 'markdown', text: before })
    const source = (match[1] ?? '').trim()
    if (source) parts.push({ type: 'mermaid', source })
    lastIndex = match.index + match[0].length
    match = MERMAID_FENCE_RE.exec(text)
  }
  const after = text.slice(lastIndex)
  if (after) parts.push({ type: 'markdown', text: after })
  if (parts.length === 0) parts.push({ type: 'markdown', text })
  return parts
}
