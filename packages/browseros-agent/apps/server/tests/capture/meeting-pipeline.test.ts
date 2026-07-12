/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCaptureConsent } from '../../src/capture/consent'
import {
  feedCaptureChunk,
  getCaptureSession,
  startMeetingCapture,
  stopMeetingCapture,
} from '../../src/capture/meeting-pipeline'
import { setCapturePausedReason } from '../../src/capture/performance'
import { setPauseOnBatteryPref } from '../../src/context/battery'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('meeting capture pipeline', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-capture-pipeline-'))
    process.env.BROWSEROS_DIR = dir
    process.env.BROWSEROS_ASR_MOCK = '1'
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

  it('stores chunks and transcript segments for a mock sidecar session', async () => {
    const session = await startMeetingCapture({
      tabId: 42,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      title: 'Standup',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })

    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('fake-audio'),
    })

    await new Promise((resolve) => setTimeout(resolve, 250))

    const stopped = await stopMeetingCapture(session.id)
    expect(stopped?.status).toBe('stopped')
    const transcriptPath = getCaptureSession(session.id)?.transcriptPath
    expect(transcriptPath).toBeTruthy()
    const transcript = await readFile(transcriptPath as string, 'utf8')
    expect(transcript).toContain('chunk 0')
  })

  it('feeds cumulative webm bytes to ASR for later timeslices', async () => {
    const session = await startMeetingCapture({
      tabId: 42,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      title: 'Standup',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })

    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('chunk-a'),
    })
    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 1,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('chunk-b'),
    })

    await new Promise((resolve) => setTimeout(resolve, 400))
    await stopMeetingCapture(session.id)

    const transcript = await readFile(
      getCaptureSession(session.id)?.transcriptPath as string,
      'utf8',
    )
    expect(transcript).toContain('chunk 0')
    expect(transcript).toContain('chunk 1')
  })
})
