import { describe, expect, test } from 'bun:test'
import { toBrowserToolExecuteResult } from '../../src/agent/tool-adapter'

describe('toBrowserToolExecuteResult', () => {
  test('forwards structuredContent', () => {
    const result = toBrowserToolExecuteResult({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
      structuredContent: { kind: 'click', changed: true, added: 2, removed: 0 },
    })
    expect(result.structuredContent).toEqual({
      kind: 'click',
      changed: true,
      added: 2,
      removed: 0,
    })
  })
})
