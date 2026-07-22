import { describe, expect, test } from 'bun:test'
import {
  buildPostActionScreenshotOptions,
  POST_ACTION_SCREENSHOT_FORMAT,
  POST_ACTION_SCREENSHOT_QUALITY,
  POST_ACTION_SCREENSHOT_SIZE,
} from './response'

describe('buildPostActionScreenshotOptions', () => {
  test('uses jpeg q80 with scaled clip to ~1024x768 (not raw png)', () => {
    const opts = buildPostActionScreenshotOptions({
      pageX: 0,
      pageY: 0,
      clientWidth: 1920,
      clientHeight: 1080,
    })

    expect(opts.format).toBe('jpeg')
    expect(opts.format).toBe(POST_ACTION_SCREENSHOT_FORMAT)
    expect(opts.quality).toBe(POST_ACTION_SCREENSHOT_QUALITY)
    expect(opts.quality).toBe(80)
    expect(opts.captureBeyondViewport).toBe(false)
    expect(opts.clip.width).toBe(1920)
    expect(opts.clip.height).toBe(1080)
    expect(opts.clip.scale).toBeCloseTo(
      Math.min(
        1,
        POST_ACTION_SCREENSHOT_SIZE.width / 1920,
        POST_ACTION_SCREENSHOT_SIZE.height / 1080,
      ),
    )
    expect(opts.clip.scale).toBeLessThan(1)
  })

  test('does not upscale small viewports', () => {
    const opts = buildPostActionScreenshotOptions({
      pageX: 10,
      pageY: 20,
      clientWidth: 800,
      clientHeight: 600,
    })
    expect(opts.clip.scale).toBe(1)
    expect(opts.clip.x).toBe(10)
    expect(opts.clip.y).toBe(20)
  })
})
