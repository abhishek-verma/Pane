/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { normalizeAcpToolTitle } from '../../../src/lib/agents/acp/tool-title'

describe('normalizeAcpToolTitle', () => {
  it('strips Tool: server/ prefixes to the bare tool name', () => {
    expect(normalizeAcpToolTitle('Tool: browseros/pi_read')).toBe('pi_read')
    expect(normalizeAcpToolTitle('Tool: browseros/context_search')).toBe(
      'context_search',
    )
  })

  it('strips bare server/ prefixes', () => {
    expect(normalizeAcpToolTitle('browseros/pi_list')).toBe('pi_list')
    expect(normalizeAcpToolTitle('nudge/suggest_app_connection')).toBe(
      'suggest_app_connection',
    )
  })

  it('leaves shell and read titles unchanged', () => {
    expect(normalizeAcpToolTitle('Read SKILL.md')).toBe('Read SKILL.md')
    expect(
      normalizeAcpToolTitle('grep -RIn "foo" /Users/abhishek/Documents'),
    ).toBe('grep -RIn "foo" /Users/abhishek/Documents')
  })

  it('trims whitespace', () => {
    expect(normalizeAcpToolTitle('  Tool: browseros/pi_open  ')).toBe('pi_open')
  })
})
