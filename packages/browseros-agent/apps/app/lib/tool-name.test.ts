import { describe, expect, test } from 'bun:test'
import { bareToolName } from './tool-name'

describe('bareToolName', () => {
  test('strips the AI SDK tool- part-type prefix', () => {
    expect(bareToolName('tool-pi_open')).toBe('pi_open')
  })

  test('strips a double-underscore MCP server prefix (Claude Code style)', () => {
    expect(bareToolName('mcp__browseros__pi_open')).toBe('pi_open')
    expect(bareToolName('mcp__browseros__filesystem_write')).toBe(
      'filesystem_write',
    )
  })

  test('strips a dot-separated MCP server prefix', () => {
    expect(bareToolName('mcp.browseros.navigate')).toBe('navigate')
  })

  test('strips both prefixes together', () => {
    expect(bareToolName('tool-mcp__browseros__pi_page_create')).toBe(
      'pi_page_create',
    )
  })

  test('leaves already-bare names untouched', () => {
    expect(bareToolName('pi_open')).toBe('pi_open')
    expect(bareToolName('filesystem_write')).toBe('filesystem_write')
  })

  test('does not strip an unrelated tool name that happens to start with mcp', () => {
    expect(bareToolName('mcpish_tool')).toBe('mcpish_tool')
  })
})
