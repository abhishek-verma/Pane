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
    expect(out.strippedImages).toEqual([])
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
    expect(out.strippedImages).toEqual([])
  })

  test('plain string', () => {
    const out = extractToolOutput('Wrote 12 bytes')
    expect(out.text).toBe('Wrote 12 bytes')
    expect(out.strippedImages).toEqual([])
  })

  // -------------------------------------------------------------------------
  // Stripped image tests (new behaviour)
  // -------------------------------------------------------------------------

  test('stripped image item: sets strippedImages, not images', () => {
    const out = extractToolOutput({
      content: [
        { type: 'text', text: '[Page 1 screenshot]' },
        { type: 'image', mimeType: 'image/jpeg', stripped: true },
      ],
      isError: false,
      structuredContent: { page: 1, format: 'jpeg', bytes: 100 },
    })
    expect(out.text).toBe('[Page 1 screenshot]')
    expect(out.images).toHaveLength(0)
    expect(out.strippedImages).toHaveLength(1)
    expect(out.strippedImages[0]).toEqual({
      stripped: true,
      mimeType: 'image/jpeg',
    })
  })

  test('stripped image falls back to image/png when mimeType absent', () => {
    const out = extractToolOutput({
      content: [{ type: 'image', stripped: true }],
      isError: false,
    })
    expect(out.strippedImages[0]?.mimeType).toBe('image/png')
  })

  test('mixed: one real image, one stripped image', () => {
    const out = extractToolOutput({
      content: [
        { type: 'image', data: 'REALDATA', mimeType: 'image/jpeg' },
        { type: 'image', mimeType: 'image/png', stripped: true },
      ],
      isError: false,
    })
    expect(out.images).toHaveLength(1)
    expect(out.images[0]?.data).toBe('REALDATA')
    expect(out.strippedImages).toHaveLength(1)
    expect(out.strippedImages[0]?.stripped).toBe(true)
  })

  test('all image items stripped → images empty, strippedImages populated', () => {
    const out = extractToolOutput({
      content: [
        { type: 'image', mimeType: 'image/png', stripped: true },
        { type: 'image', mimeType: 'image/png', stripped: true },
      ],
      isError: false,
      structuredContent: { page: 2, bytes: 200 },
    })
    expect(out.images).toHaveLength(0)
    expect(out.strippedImages).toHaveLength(2)
  })

  test('null output returns empty strippedImages', () => {
    const out = extractToolOutput(null)
    expect(out.strippedImages).toEqual([])
  })

  test('legacy structuredContent.image field is still stripped (no regression)', () => {
    const out = extractToolOutput({
      content: [],
      isError: false,
      structuredContent: { image: 'SHOULD_BE_REMOVED', page: 1 },
    })
    expect(out.structured?.image).toBeUndefined()
    expect(out.structured?.page).toBe(1)
    expect(out.strippedImages).toEqual([])
  })
})
