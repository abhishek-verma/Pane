import { describe, expect, test } from 'bun:test'
import { extractToolOutput } from './extract-output'

describe('extractToolOutput', () => {
  test('MCP content object with text + image + structured', () => {
    const out = extractToolOutput({
      content: [
        { type: 'text', text: 'ok (click)' },
        { type: 'image', data: 'abc', mimeType: 'image/png' },
      ],
      isError: false,
      structuredContent: { kind: 'click', changed: true, added: 2, removed: 1 },
    })
    expect(out.text).toContain('ok (click)')
    expect(out.isError).toBe(false)
    expect(out.images).toEqual([{ data: 'abc', mimeType: 'image/png' }])
    expect(out.structured).toEqual({
      kind: 'click',
      changed: true,
      added: 2,
      removed: 1,
    })
  })

  test('AI SDK content array + media alias', () => {
    const out = extractToolOutput([
      { type: 'text', text: 'hi' },
      { type: 'media', data: 'xyz', mediaType: 'image/jpeg' },
    ])
    expect(out.text).toBe('hi')
    expect(out.images[0]?.mimeType).toBe('image/jpeg')
  })

  test('plain string', () => {
    expect(extractToolOutput('Wrote 12 bytes').text).toBe('Wrote 12 bytes')
  })
})
