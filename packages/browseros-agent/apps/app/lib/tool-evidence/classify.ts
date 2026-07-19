import type { ToolVisibilityKind } from './types'

const FILE_CHANGE = new Set(['filesystem_edit', 'filesystem_write'])
const BROWSER_ACTION = new Set(['act', 'navigate', 'upload', 'download'])
const SCREENSHOT = new Set(['screenshot'])
const TERMINAL = new Set(['filesystem_bash'])

/** Known Strata / connector send-style tool names. */
const APP_SEND_EXACT = new Set(['execute_action'])

/**
 * Unknown MCP / connector tools that look like external writes.
 * Applied only after known file/browser/terminal classifications.
 */
const APP_SEND_NAME_RE =
  /send|email|slack|message|post|create_issue|create_pr|execute_action|connector_mcp/i

export function classifyToolVisibility(toolName: string): ToolVisibilityKind {
  const name = toolName.replace(/^tool-/, '')
  if (FILE_CHANGE.has(name)) return 'file-change'
  if (BROWSER_ACTION.has(name)) return 'browser-action'
  if (SCREENSHOT.has(name)) return 'screenshot'
  if (TERMINAL.has(name)) return 'terminal'
  if (isAppSendTool(name)) return 'app-send'
  return 'generic'
}

function isAppSendTool(name: string): boolean {
  if (APP_SEND_EXACT.has(name)) return true
  if (name.includes('execute_action')) return true
  // connector_mcp_servers is discovery/status — keep generic.
  if (name === 'connector_mcp_servers') return false
  return APP_SEND_NAME_RE.test(name)
}

export function isSpecializedKind(kind: ToolVisibilityKind): boolean {
  return (
    kind === 'file-change' ||
    kind === 'browser-action' ||
    kind === 'screenshot' ||
    kind === 'terminal' ||
    kind === 'app-send'
  )
}
