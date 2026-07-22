import { describe, expect, test } from 'bun:test'
import { shouldMountBrowserThumb } from './browser-thumb-mount'

describe('shouldMountBrowserThumb', () => {
  test('mounts when near viewport', () => {
    expect(
      shouldMountBrowserThumb({
        nearViewport: true,
        highlighted: false,
        hasImageSource: true,
        showBrowserScreenshots: true,
        imageFailed: false,
      }),
    ).toBe(true)
  })

  test('mounts when highlighted even if offscreen', () => {
    expect(
      shouldMountBrowserThumb({
        nearViewport: false,
        highlighted: true,
        hasImageSource: true,
        showBrowserScreenshots: true,
        imageFailed: false,
      }),
    ).toBe(true)
  })

  test('does not mount when offscreen and not highlighted', () => {
    expect(
      shouldMountBrowserThumb({
        nearViewport: false,
        highlighted: false,
        hasImageSource: true,
        showBrowserScreenshots: true,
        imageFailed: false,
      }),
    ).toBe(false)
  })

  test('does not mount when screenshots hidden or failed', () => {
    expect(
      shouldMountBrowserThumb({
        nearViewport: true,
        highlighted: true,
        hasImageSource: true,
        showBrowserScreenshots: false,
        imageFailed: false,
      }),
    ).toBe(false)
    expect(
      shouldMountBrowserThumb({
        nearViewport: true,
        highlighted: true,
        hasImageSource: true,
        showBrowserScreenshots: true,
        imageFailed: true,
      }),
    ).toBe(false)
  })

  test('does not mount without an image source', () => {
    expect(
      shouldMountBrowserThumb({
        nearViewport: true,
        highlighted: true,
        hasImageSource: false,
        showBrowserScreenshots: true,
        imageFailed: false,
      }),
    ).toBe(false)
  })
})
