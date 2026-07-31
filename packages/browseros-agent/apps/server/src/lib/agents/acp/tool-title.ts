/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * ACP / Codex MCP tool titles arrive as `Tool: <server>/<name>` (or bare
 * `<server>/<name>`). The AI SDK ToolLoopAgent registry uses bare names
 * (`pi_read`). Strip the MCP display prefix so stream parts match.
 */

/** `Tool: browseros/pi_read` or `browseros/pi_read` → bare identifier. */
const MCP_TOOL_TITLE_RE = /^(?:Tool:\s*)?([A-Za-z][\w-]*)\/([A-Za-z_][\w-]*)$/i

/**
 * Map an ACP tool title to the bare tool name used in Pane's tool registry.
 * Leaves shell/read titles (`grep …`, `Read SKILL.md`) unchanged.
 */
export function normalizeAcpToolTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return trimmed
  const match = MCP_TOOL_TITLE_RE.exec(trimmed)
  return match?.[2] ?? trimmed
}
