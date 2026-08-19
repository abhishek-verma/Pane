/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaptureRoutes } from '../../src/api/routes/capture'
import { resetDictationSessionsForTests } from '../../src/capture/dictation-session'
import {
  registeredAsrSessionCount,
  resetSharedAsrWorkerForTests,
} from '../../src/capture/shared-asr-worker'

function feedRequest(final: boolean, force = false): FormData {
  const form = new FormData()
  form.append(
    'file',
    new File([new Uint8Array([1, 2, 3, 4])], 'recording.webm', {
      type: 'audio/webm',
    }),
  )
  form.append('final', String(final))
  form.append('force', String(force))
  return form
}

/** Reads SSE frames off a streamed Response until one segment event lands, then aborts. */
async function readOneSegment(
  res: Response,
  controller: AbortController,
): Promise<{ text: string; cumulative: string } | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const decoder = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + 5_000
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) return null
      buf += decoder.decode(value, { stream: true })
      const frames = buf.split('\n\n')
      buf = frames.pop() ?? ''
      for (const frame of frames) {
        if (!frame.includes('event: segment')) continue
        const dataLine = frame
          .split('\n')
          .find((line) => line.startsWith('data: '))
        if (!dataLine) continue
        return JSON.parse(dataLine.slice('data: '.length))
      }
    }
    return null
  } finally {
    controller.abort()
  }
}

describe('dictation routes', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-dictation-route-'))
    process.env.BROWSEROS_DIR = dir
    process.env.BROWSEROS_ASR_MOCK = '1'
    resetSharedAsrWorkerForTests()
    resetDictationSessionsForTests()
  })

  afterEach(() => {
    delete process.env.BROWSEROS_DIR
    delete process.env.BROWSEROS_ASR_MOCK
    resetDictationSessionsForTests()
  })

  it('non-final feed acks without text, and a later GET /events replays it', async () => {
    const app = createCaptureRoutes()
    const sessionId = 'dictation:test-replay'

    const feedRes = await app.request(`/dictation/${sessionId}/feed`, {
      method: 'POST',
      body: feedRequest(false),
    })
    expect(feedRes.status).toBe(200)
    expect(await feedRes.json()).toEqual({ ok: true })

    const controller = new AbortController()
    const eventsRes = await app.request(`/dictation/${sessionId}/events`, {
      signal: controller.signal,
    })
    const segment = await readOneSegment(eventsRes, controller)
    expect(segment?.text).toContain('[chunk 0]')

    await app.request(`/dictation/${sessionId}`, { method: 'DELETE' })
  })

  it('final feed returns cumulative text and unregisters the session', async () => {
    const app = createCaptureRoutes()
    const sessionId = 'dictation:test-final'

    const res = await app.request(`/dictation/${sessionId}/feed`, {
      method: 'POST',
      body: feedRequest(true, true),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; text: string }
    expect(body.ok).toBe(true)
    expect(body.text).toContain('[chunk 0]')
    expect(registeredAsrSessionCount()).toBe(0)
  })

  it('DELETE is idempotent and cleans up an in-progress session', async () => {
    const app = createCaptureRoutes()
    const sessionId = 'dictation:test-delete'

    await app.request(`/dictation/${sessionId}/feed`, {
      method: 'POST',
      body: feedRequest(false),
    })
    expect(registeredAsrSessionCount()).toBe(1)

    const first = await app.request(`/dictation/${sessionId}`, {
      method: 'DELETE',
    })
    expect(first.status).toBe(200)
    expect(registeredAsrSessionCount()).toBe(0)

    const second = await app.request(`/dictation/${sessionId}`, {
      method: 'DELETE',
    })
    expect(second.status).toBe(200)
  })

  it('delivers a segment published before the events stream connects (subscribe after publish)', async () => {
    const app = createCaptureRoutes()
    const sessionId = 'dictation:test-late-subscribe'

    await app.request(`/dictation/${sessionId}/feed`, {
      method: 'POST',
      body: feedRequest(false),
    })

    const controller = new AbortController()
    const eventsRes = await app.request(`/dictation/${sessionId}/events`, {
      signal: controller.signal,
    })
    const segment = await readOneSegment(eventsRes, controller)
    expect(segment?.text).toContain('[chunk 0]')

    await app.request(`/dictation/${sessionId}`, { method: 'DELETE' })
  })
})
