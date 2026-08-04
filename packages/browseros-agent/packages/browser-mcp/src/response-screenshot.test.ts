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

  // Regression: CDP's clip.scale multiplies CSS pixels, but the captured
  // raster is still emitted at the page's actual device pixel ratio on top
  // of that. Without accounting for DPR, a "1024x768" clip on a 2x/3x
  // display rasterizes at ~2048x1536 / ~3072x2304 — over a 2000x2000px
  // downstream image-size limit (e.g. what an ACP host enforces before
  // sending the tool result to the model), causing `navigate`/`act` to come
  // back as a hard tool failure even though the action itself succeeded.
  test('accounts for devicePixelRatio so the final raster stays within budget (2x HiDPI)', () => {
    const clientWidth = 1920
    const clientHeight = 1080
    const dpr = 2
    const opts = buildPostActionScreenshotOptions(
      { pageX: 0, pageY: 0, clientWidth, clientHeight },
      dpr,
    )
    const rasterWidth = clientWidth * opts.clip.scale * dpr
    const rasterHeight = clientHeight * opts.clip.scale * dpr
    expect(rasterWidth).toBeLessThanOrEqual(POST_ACTION_SCREENSHOT_SIZE.width)
    expect(rasterHeight).toBeLessThanOrEqual(POST_ACTION_SCREENSHOT_SIZE.height)
  })

  test('scales down a small-CSS but high-DPR viewport that would otherwise raster oversized (3x HiDPI)', () => {
    const clientWidth = 800
    const clientHeight = 600
    const dpr = 3
    const opts = buildPostActionScreenshotOptions(
      { pageX: 0, pageY: 0, clientWidth, clientHeight },
      dpr,
    )
    // At dpr=1 this viewport wouldn't be scaled at all (see the test above);
    // at dpr=3 the physical raster (2400x1800) is well over budget, so it
    // must still be scaled down even though the CSS size looks small.
    expect(opts.clip.scale).toBeLessThan(1)
    const rasterWidth = clientWidth * opts.clip.scale * dpr
    expect(rasterWidth).toBeLessThanOrEqual(POST_ACTION_SCREENSHOT_SIZE.width)
  })

  test('defaults devicePixelRatio to 1 when omitted (back-compat)', () => {
    const opts = buildPostActionScreenshotOptions({
      pageX: 0,
      pageY: 0,
      clientWidth: 1920,
      clientHeight: 1080,
    })
    expect(opts.clip.scale).toBeCloseTo(
      Math.min(
        1,
        POST_ACTION_SCREENSHOT_SIZE.width / 1920,
        POST_ACTION_SCREENSHOT_SIZE.height / 1080,
      ),
    )
  })
})
