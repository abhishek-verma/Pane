import { describe, expect, test } from 'bun:test'
import { classifyToolVisibility, isSpecializedKind } from './classify'

describe('classifyToolVisibility', () => {
  test('file mutations', () => {
    expect(classifyToolVisibility('filesystem_edit')).toBe('file-change')
    expect(classifyToolVisibility('filesystem_write')).toBe('file-change')
  })

  test('browser mutations / nav / screenshot product', () => {
    expect(classifyToolVisibility('act')).toBe('browser-action')
    expect(classifyToolVisibility('navigate')).toBe('browser-action')
    expect(classifyToolVisibility('upload')).toBe('browser-action')
    expect(classifyToolVisibility('download')).toBe('browser-action')
    expect(classifyToolVisibility('screenshot')).toBe('screenshot')
  })

  test('filesystem_bash → terminal', () => {
    expect(classifyToolVisibility('filesystem_bash')).toBe('terminal')
    expect(classifyToolVisibility('tool-filesystem_bash')).toBe('terminal')
    expect(isSpecializedKind('terminal')).toBe(true)
  })

  test('app-send heuristics', () => {
    expect(classifyToolVisibility('execute_action')).toBe('app-send')
    expect(classifyToolVisibility('strata_execute_action')).toBe('app-send')
    expect(classifyToolVisibility('slack_send_message')).toBe('app-send')
    expect(classifyToolVisibility('gmail_send_email')).toBe('app-send')
    expect(classifyToolVisibility('create_issue')).toBe('app-send')
    expect(classifyToolVisibility('create_pr')).toBe('app-send')
    expect(classifyToolVisibility('post_to_channel')).toBe('app-send')
    expect(isSpecializedKind('app-send')).toBe(true)
  })

  test('connector discovery stays generic; reads stay generic', () => {
    expect(classifyToolVisibility('connector_mcp_servers')).toBe('generic')
    expect(classifyToolVisibility('filesystem_read')).toBe('generic')
    expect(classifyToolVisibility('snapshot')).toBe('generic')
    expect(classifyToolVisibility('unknown_mcp_tool')).toBe('generic')
  })
})
