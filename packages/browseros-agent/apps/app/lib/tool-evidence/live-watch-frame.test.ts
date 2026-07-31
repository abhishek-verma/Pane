import { describe, expect, test } from 'bun:test'
import {
  isLiveWatchSparse,
  replaceLiveWatchBlobUrl,
  shouldCommitLiveWatchFrame,
} from './live-watch-frame'

describe('replaceLiveWatchBlobUrl', () => {
  test('frame floods keep a single live blob URL and revoke the previous', () => {
    const revoked: string[] = []
    const origRevoke = URL.revokeObjectURL.bind(URL)
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url)
      origRevoke(url)
    }

    let live: string | null = null
    try {
      for (let i = 0; i < 20; i++) {
        // Valid tiny base64 payload (decoded bytes do not need to be a real JPEG).
        const b64 = btoa(`frame-${i}-${'x'.repeat(32)}`)
        live = replaceLiveWatchBlobUrl(live, b64)
      }

      expect(live).toMatch(/^blob:/)
      // All but the last URL should have been revoked.
      expect(revoked.length).toBe(19)
      expect(revoked.includes(live ?? '')).toBe(false)
    } finally {
      if (live) origRevoke(live)
      URL.revokeObjectURL = origRevoke
    }
  })
})

describe('shouldCommitLiveWatchFrame', () => {
  test('rate-limits commits under the interval floor', () => {
    expect(
      shouldCommitLiveWatchFrame({
        now: 1_050,
        lastCommitAt: 1_000,
        rafScheduledAt: 1_050,
        minIntervalMs: 100,
      }),
    ).toBe('wait_interval')
  })

  test('commits when the interval has elapsed', () => {
    expect(
      shouldCommitLiveWatchFrame({
        now: 1_200,
        lastCommitAt: 1_000,
        rafScheduledAt: 1_200,
        minIntervalMs: 100,
      }),
    ).toBe('commit')
  })

  test('drops when the event loop is lagging', () => {
    expect(
      shouldCommitLiveWatchFrame({
        now: 1_200,
        lastCommitAt: 0,
        rafScheduledAt: 1_000,
        lagDropMs: 50,
      }),
    ).toBe('drop_lag')
  })
})

describe('isLiveWatchSparse', () => {
  test('connected without recent frames is sparse', () => {
    expect(
      isLiveWatchSparse({
        status: 'connected',
        hasBlob: true,
        lastFrameAt: 1_000,
        now: 4_000,
        sparseMs: 2_500,
      }),
    ).toBe(true)
  })

  test('fresh frames are not sparse', () => {
    expect(
      isLiveWatchSparse({
        status: 'connected',
        hasBlob: true,
        lastFrameAt: 3_800,
        now: 4_000,
        sparseMs: 2_500,
      }),
    ).toBe(false)
  })
})
