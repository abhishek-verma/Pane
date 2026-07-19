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
import { setCaptureConsent } from '../../src/capture/consent'
import {
  startMeetingCapture,
  stopMeetingCapture,
} from '../../src/capture/meeting-pipeline'
import { setCapturePausedReason } from '../../src/capture/performance'
import { resetSharedAsrWorkerForTests } from '../../src/capture/shared-asr-worker'
import {
  clearSpeakerTimeline,
  resolveSpeakerAt,
} from '../../src/capture/speaker-timeline'
import { setPauseOnBatteryPref } from '../../src/context/battery'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('POST /capture/meetings/:id/speaker (B-T5)', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-speaker-route-'))
    process.env.BROWSEROS_DIR = dir
    process.env.BROWSEROS_ASR_MOCK = '1'
    resetSharedAsrWorkerForTests()
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    setCaptureConsent({
      domain: 'meet.google.com',
      class: 'meeting',
      allowed: true,
    })
    setPauseOnBatteryPref(false)
    setCapturePausedReason(null)
  })

  afterEach(() => {
    delete process.env.BROWSEROS_DIR
    delete process.env.BROWSEROS_ASR_MOCK
    closeDb()
  })

  it('returns 404 for unknown session', async () => {
    const app = createCaptureRoutes()
    const res = await app.request('/meetings/does-not-exist/speaker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Ada',
        confidence: 0.9,
        observedAt: Date.now(),
        source: 'dom-active',
      }),
    })
    expect(res.status).toBe(404)
  })

  it('returns 400 for bad body', async () => {
    const session = await startMeetingCapture({
      tabId: 1,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      requireConsent: true,
    })
    const app = createCaptureRoutes()
    const res = await app.request(`/meetings/${session.id}/speaker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: '' }),
    })
    expect(res.status).toBe(400)
    await stopMeetingCapture(session.id)
    clearSpeakerTimeline(session.id)
  })

  it('records observation for active session', async () => {
    const session = await startMeetingCapture({
      tabId: 1,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      requireConsent: true,
    })
    const at = Date.now()
    const app = createCaptureRoutes()
    const res = await app.request(`/meetings/${session.id}/speaker`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: 'Ada',
        confidence: 0.9,
        observedAt: at,
        source: 'dom-active',
      }),
    })
    expect(res.status).toBe(200)
    expect(resolveSpeakerAt(session.id, at)?.displayName).toBe('Ada')
    await stopMeetingCapture(session.id)
  })
})
