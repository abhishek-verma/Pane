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

  test('reads stay generic', () => {
    expect(classifyToolVisibility('filesystem_read')).toBe('generic')
    expect(classifyToolVisibility('snapshot')).toBe('generic')
    expect(classifyToolVisibility('unknown_mcp_tool')).toBe('generic')
  })
})
