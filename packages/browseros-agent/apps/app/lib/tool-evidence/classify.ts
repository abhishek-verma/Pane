import type { ToolVisibilityKind } from './types'

const FILE_CHANGE = new Set(['filesystem_edit', 'filesystem_write'])
const BROWSER_ACTION = new Set(['act', 'navigate', 'upload', 'download'])
const SCREENSHOT = new Set(['screenshot'])
const TERMINAL = new Set(['filesystem_bash'])

export function classifyToolVisibility(toolName: string): ToolVisibilityKind {
  const name = toolName.replace(/^tool-/, '')
  if (FILE_CHANGE.has(name)) return 'file-change'
  if (BROWSER_ACTION.has(name)) return 'browser-action'
  if (SCREENSHOT.has(name)) return 'screenshot'
  if (TERMINAL.has(name)) return 'terminal'
  return 'generic'
}

export function isSpecializedKind(kind: ToolVisibilityKind): boolean {
  return (
    kind === 'file-change' ||
    kind === 'browser-action' ||
    kind === 'screenshot' ||
    kind === 'terminal'
  )
}
