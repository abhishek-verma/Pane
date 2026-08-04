/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * ACP-backed providers (Claude Code, etc.) report BrowserOS MCP tool calls
 * with a server-name prefix — `mcp__browseros__pi_open`, `mcp.browseros.
 * navigate` — instead of the bare name the in-process tool loop uses. Any
 * code that matches tool names by exact string (card detection, evidence
 * classification, nudge detection, labels) must normalize first, or
 * ACP-routed calls silently fall through to generic/unclassified handling
 * even though the tool executed successfully.
 */

const TOOL_PART_PREFIX_RE = /^tool-/
const MCP_TOOL_PREFIX_RE = /^mcp[._]+[a-z0-9-]+[._]+/i

/** Strips the AI SDK `tool-` part-type prefix and any ACP MCP server-name prefix. */
export function bareToolName(name: string): string {
  return name.replace(TOOL_PART_PREFIX_RE, '').replace(MCP_TOOL_PREFIX_RE, '')
}
