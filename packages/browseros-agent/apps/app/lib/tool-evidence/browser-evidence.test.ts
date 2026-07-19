import { describe, expect, test } from 'bun:test'
import {
  buildActCaption,
  buildBrowserActionDetail,
  buildPageDiffSummary,
} from './browser-evidence'

describe('buildActCaption', () => {
  test('prefers human text over ref', () => {
    expect(
      buildActCaption({
        kind: 'click',
        ref: 'e12',
        text: 'Create issue',
      }),
    ).toBe('Clicked "Create issue"')
  })

  test('falls back to ref', () => {
    expect(buildActCaption({ kind: 'click', ref: 'e12' })).toBe('Clicked e12')
  })
})

describe('buildPageDiffSummary', () => {
  test('uses structured counts', () => {
    expect(
      buildPageDiffSummary({
        structured: {
          changed: true,
          added: 3,
          removed: 1,
          urlChanged: true,
          afterUrl: 'https://example.com/thanks',
        },
        text: '',
      }),
    ).toContain('URL →')
  })

  test('no change', () => {
    expect(
      buildPageDiffSummary({
        structured: { changed: false },
        text: 'no change since last snapshot',
      }),
    ).toBe('No page change')
  })
})

describe('buildBrowserActionDetail', () => {
  test('screenshot tool attaches media', () => {
    const d = buildBrowserActionDetail({
      toolName: 'screenshot',
      input: { page: 1 },
      outputText: 'captured',
      structured: { url: 'https://github.com/x' },
      images: [{ data: 'AAA', mimeType: 'image/png' }],
    })
    expect(d.caption).toContain('Screenshot')
    expect(d.media).toHaveLength(1)
    expect(d.hostname).toBe('github.com')
  })
})
