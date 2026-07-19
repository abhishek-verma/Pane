/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { BROWSER_TOOLS } from '@browseros/browser-mcp/registry'
import type { ToolSet } from 'ai'

/** Read-only / observation browser tools allowed in chat mode. */
export const CHAT_MODE_ALLOWED_TOOLS = new Set([
  ...BROWSER_TOOLS.filter((tool) => tool.annotations?.readOnlyHint).map(
    (tool) => tool.name,
  ),
  'tabs',
])

/**
 * Non-browser tools that are safe in read-only chat mode.
 * Writes (memory/tasks/home/skills/capture stop) stay out.
 */
export const CHAT_MODE_ALLOWED_NON_BROWSER_TOOLS = new Set([
  'capture_list',
  'capture_read',
  'capture_status',
  'context_current_work',
  'context_search',
  'context_recall',
  'tasks_list',
  'skills_list',
  'skills_load',
  'home_widget_list',
  'filesystem_read',
])

export function isChatModeToolAllowed(toolName: string): boolean {
  return (
    CHAT_MODE_ALLOWED_TOOLS.has(toolName) ||
    CHAT_MODE_ALLOWED_NON_BROWSER_TOOLS.has(toolName)
  )
}

/** Drop mutating / unavailable tools from a merged tool set for chat mode. */
export function filterToolsForChatMode(tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => isChatModeToolAllowed(name)),
  )
}
