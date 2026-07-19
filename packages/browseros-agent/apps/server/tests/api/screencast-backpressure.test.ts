import { describe, expect, it } from 'bun:test'
import { SCREENCAST_LIMITS } from '@browseros/shared/constants/limits'
import type { WSContext } from 'hono/ws'
import { subscriberBufferedAmount } from '../../src/api/services/screencast/screencast-manager'

describe('screencast subscriber backpressure', () => {
  it('reads bufferedAmount from raw websocket when present', () => {
    const ws = {
      readyState: 1,
      raw: { bufferedAmount: 1234 },
      send() {},
    } as unknown as WSContext<unknown>
    expect(subscriberBufferedAmount(ws)).toBe(1234)
  })

  it('falls back to top-level bufferedAmount', () => {
    const ws = {
      readyState: 1,
      bufferedAmount: 99,
      send() {},
    } as unknown as WSContext<unknown>
    expect(subscriberBufferedAmount(ws)).toBe(99)
  })

  it('returns 0 when bufferedAmount is missing', () => {
    const ws = {
      readyState: 1,
      send() {},
    } as unknown as WSContext<unknown>
    expect(subscriberBufferedAmount(ws)).toBe(0)
  })

  it('backpressure threshold is positive', () => {
    expect(SCREENCAST_LIMITS.SUBSCRIBER_BACKPRESSURE_BYTES).toBeGreaterThan(0)
    expect(SCREENCAST_LIMITS.EVERY_NTH_FRAME).toBeGreaterThanOrEqual(2)
    expect(SCREENCAST_LIMITS.DEFAULT_JPEG_QUALITY).toBeLessThanOrEqual(60)
    expect(SCREENCAST_LIMITS.MAX_WIDTH).toBeLessThanOrEqual(800)
  })
})
