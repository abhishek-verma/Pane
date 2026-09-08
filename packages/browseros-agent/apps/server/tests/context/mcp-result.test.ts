import { describe, expect, it } from 'bun:test'
import { toMcpToolResult } from '../../src/context/register-mcp'

describe('AI SDK to MCP result boundary', () => {
  it('preserves structured scheduler data, including empty lists and false results', () => {
    for (const result of [
      { triggers: [] },
      { triggers: [{ id: 'rule-1', enabled: false, name: 'Daily' }] },
      { deleted: false },
    ]) {
      expect(JSON.parse(toMcpToolResult(result).content[0].text)).toEqual(
        result,
      )
    }
  })

  it('preserves text and approval/error envelopes without double encoding', () => {
    expect(toMcpToolResult({ text: 'Denied', isError: true })).toEqual({
      content: [{ type: 'text', text: 'Denied' }],
      isError: true,
    })
    expect(toMcpToolResult({ text: '' }).content[0].text).toBe('')
  })
})
