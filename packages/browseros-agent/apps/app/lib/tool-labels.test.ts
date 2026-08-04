import { describe, expect, test } from 'bun:test'
import { buildToolLabel } from './tool-labels'

describe('buildToolLabel', () => {
  test('maps a bare tool name to its curated verb', () => {
    expect(buildToolLabel('click', { element: 'Submit' }).label).toBe('Clicked')
  })

  test('maps an ACP-namespaced tool name (mcp__browseros__ prefix) to the same curated verb', () => {
    // Before the bareToolName() fix, canonicalName() only stripped a
    // "browseros__" or "mcp_" (single underscore) prefix, so
    // "mcp__browseros__click" fell through to the raw-name humanized
    // fallback instead of the curated "Clicked" label.
    const result = buildToolLabel('mcp__browseros__click', {
      element: 'Submit',
    })
    expect(result.label).toBe('Clicked')
    expect(result.subject).toBe('Submit')
  })

  test('maps a dot-namespaced tool name (mcp.browseros. prefix) to the same curated verb', () => {
    expect(buildToolLabel('mcp.browseros.click').label).toBe('Clicked')
  })

  test('falls back to a humanized name for unknown tools', () => {
    expect(buildToolLabel('some_custom_tool').label).toBe('Some custom tool')
  })
})
