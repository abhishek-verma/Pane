import { describe, expect, test } from 'bun:test'
import type { ProtocolApi } from '@browseros/cdp-protocol/protocol-api'
import { buildScreenshotClip } from './screenshot'

function fakeSession(opts: {
  clientWidth: number
  clientHeight: number
  devicePixelRatio?: number | null
}): ProtocolApi {
  return {
    Page: {
      getLayoutMetrics: async () => ({
        cssLayoutViewport: {
          pageX: 0,
          pageY: 0,
          clientWidth: opts.clientWidth,
          clientHeight: opts.clientHeight,
        },
      }),
    },
    Runtime: {
      evaluate: async () =>
        opts.devicePixelRatio == null
          ? { result: {} }
          : { result: { value: opts.devicePixelRatio } },
    },
  } as unknown as ProtocolApi
}

const TARGET = { width: 1024, height: 768 } as const

describe('buildScreenshotClip', () => {
  test('does not scale down at dpr=1 when viewport already fits the target', async () => {
    const clip = await buildScreenshotClip(
      fakeSession({ clientWidth: 800, clientHeight: 600, devicePixelRatio: 1 }),
      TARGET,
    )
    expect(clip.scale).toBe(1)
  })

  // Regression: CDP's clip.scale multiplies CSS pixels, but the captured
  // raster is still emitted at the page's actual device pixel ratio on top
  // of that. Without folding DPR into the scale, a "1024x768" clip on a 2x
  // HiDPI display rasterizes at ~2048x1536 — over a 2000x2000px downstream
  // image-size limit (e.g. enforced by an ACP host) even though the
  // requested target looked safely small.
  test('accounts for devicePixelRatio so the final raster stays within the target size (2x HiDPI)', async () => {
    const clientWidth = 1920
    const clientHeight = 1080
    const dpr = 2
    const clip = await buildScreenshotClip(
      fakeSession({ clientWidth, clientHeight, devicePixelRatio: dpr }),
      TARGET,
    )
    const rasterWidth = clientWidth * clip.scale * dpr
    const rasterHeight = clientHeight * clip.scale * dpr
    expect(rasterWidth).toBeLessThanOrEqual(TARGET.width)
    expect(rasterHeight).toBeLessThanOrEqual(TARGET.height)
  })

  test('scales down a small-CSS but high-DPR viewport that would otherwise raster oversized (3x HiDPI)', async () => {
    const clientWidth = 800
    const clientHeight = 600
    const dpr = 3
    const clip = await buildScreenshotClip(
      fakeSession({ clientWidth, clientHeight, devicePixelRatio: dpr }),
      TARGET,
    )
    expect(clip.scale).toBeLessThan(1)
    const rasterWidth = clientWidth * clip.scale * dpr
    expect(rasterWidth).toBeLessThanOrEqual(TARGET.width)
  })

  test('falls back to dpr=1 when the page evaluate call fails or returns no value', async () => {
    const clip = await buildScreenshotClip(
      fakeSession({
        clientWidth: 1920,
        clientHeight: 1080,
        devicePixelRatio: null,
      }),
      TARGET,
    )
    expect(clip.scale).toBeCloseTo(Math.min(1, 1024 / 1920, 768 / 1080))
  })
})
