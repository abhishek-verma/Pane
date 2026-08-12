/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCaptureConsent } from '../../src/capture/consent'
import {
  feedCaptureChunk,
  findResumableSession,
  getCaptureSession,
  interruptMeetingCapture,
  ROOM_RESUME_TTL_MS,
  startMeetingCapture,
  stopMeetingCapture,
} from '../../src/capture/meeting-pipeline'
import { setCapturePausedReason } from '../../src/capture/performance'
import { resetSharedAsrWorkerForTests } from '../../src/capture/shared-asr-worker'
import { setPauseOnBatteryPref } from '../../src/context/battery'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('capture continuity contracts', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-capture-continuity-'))
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

  it('persists chunks while load pause would refuse new sessions (A1)', async () => {
    const a = await startMeetingCapture({
      tabId: 1,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      requireConsent: true,
    })
    const b = await startMeetingCapture({
      tabId: 2,
      bucketId: 'default',
      url: 'https://meet.google.com/bbb-cccc-ddd',
      requireConsent: true,
    })
    // At capacity (2) — new starts refused, existing persists still work.
    await expect(
      startMeetingCapture({
        tabId: 3,
        bucketId: 'default',
        url: 'https://meet.google.com/xyz-abcd-efg',
      }),
    ).rejects.toThrow(/paused/)
    await feedCaptureChunk({
      sessionId: a.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('audio-under-load'),
    })
    const stream = join(
      a.transcriptPath?.replace(/\/transcript\.jsonl$/, ''),
      'audio-chunks',
      'stream.webm',
    )
    expect(existsSync(stream)).toBe(true)
    await stopMeetingCapture(a.id)
    await stopMeetingCapture(b.id)
  })

  it('persists mic and mixed tracks separately (A14)', async () => {
    const session = await startMeetingCapture({
      tabId: 1,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      includeMic: true,
    })
    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      track: 'mixed',
      data: new TextEncoder().encode('mixed-0'),
    })
    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      track: 'mic',
      data: new TextEncoder().encode('mic-0'),
    })
    const dir = join(
      session.transcriptPath?.replace(/\/transcript\.jsonl$/, ''),
      'audio-chunks',
    )
    expect(existsSync(join(dir, 'stream.webm'))).toBe(true)
    expect(existsSync(join(dir, 'mic-stream.webm'))).toBe(true)
  })

  it('resumes interrupted session by roomKey within TTL (A11)', async () => {
    const first = await startMeetingCapture({
      tabId: 1,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
    })
    expect(first.roomKey).toBe('meet:abc-defg-hij')
    await interruptMeetingCapture(first.id)
    expect(getCaptureSession(first.id)?.status).toBe('interrupted')

    const found = findResumableSession({
      bucketId: 'default',
      site: 'meet',
      roomKey: 'meet:abc-defg-hij',
    })
    expect(found?.id).toBe(first.id)

    const resumed = await startMeetingCapture({
      tabId: 2,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
    })
    expect(resumed.id).toBe(first.id)
    expect(resumed.status).toBe('active')
    const transcript = await readFile(resumed.transcriptPath!, 'utf8')
    expect(transcript).toContain('"kind":"gap"')
  })

  it('does not merge roomKey after TTL expiry (A12)', async () => {
    const first = await startMeetingCapture({
      tabId: 1,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
    })
    await interruptMeetingCapture(first.id)
    // Age last_chunk_at beyond TTL
    const { getDbHandle } = await import('../../src/lib/db')
    getDbHandle()
      .sqlite.prepare(
        `UPDATE capture_sessions SET last_chunk_at = ? WHERE id = ?`,
      )
      .run(Date.now() - ROOM_RESUME_TTL_MS - 1_000, first.id)

    const second = await startMeetingCapture({
      tabId: 2,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
    })
    expect(second.id).not.toBe(first.id)
    await stopMeetingCapture(second.id)
  })

  it('writes asr-state.json after mixed feed', async () => {
    const session = await startMeetingCapture({
      tabId: 1,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
    })
    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('state-chunk'),
    })
    await stopMeetingCapture(session.id)
    const statePath = join(
      session.transcriptPath?.replace(/\/transcript\.jsonl$/, ''),
      'asr-state.json',
    )
    expect(existsSync(statePath)).toBe(true)
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      lastContiguousSequence: number
    }
    expect(state.lastContiguousSequence).toBe(0)
  })
})
