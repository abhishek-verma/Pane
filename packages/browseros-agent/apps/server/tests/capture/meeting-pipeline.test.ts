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
  reconcileStaleActiveCaptureSessions,
  rehydrateActiveCaptureSessions,
  startMeetingCapture,
  stopMeetingCapture,
} from '../../src/capture/meeting-pipeline'
import { setCapturePausedReason } from '../../src/capture/performance'
import { resetSharedAsrWorkerForTests } from '../../src/capture/shared-asr-worker'
import { setPauseOnBatteryPref } from '../../src/context/battery'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'

describe('meeting capture pipeline', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-capture-pipeline-'))
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

    // stopMeetingCapture drains the ASR queue (rehydrate + feed).
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

    await stopMeetingCapture(session.id)

    const transcript = await readFile(
      getCaptureSession(session.id)?.transcriptPath as string,
      'utf8',
    )
    expect(transcript).toContain('chunk 0')
    expect(transcript).toContain('chunk 1')
  })

  it('skips empty active sessions on bulk rehydrate (avoids ASR crash-loops)', async () => {
    const session = await startMeetingCapture({
      tabId: 42,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      title: 'Standup',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })

    // Simulate server restart: drop in-memory state while DB stays active,
    // with no audio on disk (zombie empty session).
    await stopMeetingCapture(session.id)
    getDbHandle()
      .sqlite.prepare(
        `UPDATE capture_sessions
         SET status = 'active', ended_at = NULL, graph_node_id = NULL
         WHERE id = ?`,
      )
      .run(session.id)

    const restored = await rehydrateActiveCaptureSessions()
    expect(restored).toBe(0)

    // Lazy rehydrate happens on the ASR queue after disk persist.
    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('after-restart'),
    })
    await stopMeetingCapture(session.id)

    const transcript = await readFile(
      getCaptureSession(session.id)?.transcriptPath as string,
      'utf8',
    )
    expect(transcript).toContain('chunk 0')
  })

  it('bulk-rehydrates active sessions that already have audio on disk', async () => {
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
      data: new TextEncoder().encode('before-restart'),
    })

    // Drop in-memory ASR while keeping DB active + stream.webm on disk.
    await stopMeetingCapture(session.id)
    getDbHandle()
      .sqlite.prepare(
        `UPDATE capture_sessions
         SET status = 'active', ended_at = NULL, graph_node_id = NULL
         WHERE id = ?`,
      )
      .run(session.id)

    const restored = await rehydrateActiveCaptureSessions()
    expect(restored).toBe(1)

    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 1,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('after-rehydrate'),
    })
    await stopMeetingCapture(session.id)

    const transcript = await readFile(
      getCaptureSession(session.id)?.transcriptPath as string,
      'utf8',
    )
    expect(transcript).toContain('chunk 0')
    expect(transcript).toContain('chunk 1')
  })

  it('reconciles empty active zombies after the empty-session grace period', async () => {
    const session = await startMeetingCapture({
      tabId: 42,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })
    await stopMeetingCapture(session.id)
    getDbHandle()
      .sqlite.prepare(
        `UPDATE capture_sessions
         SET status = 'active', ended_at = NULL, started_at = ?
         WHERE id = ?`,
      )
      .run(Date.now() - 61_000, session.id)

    const stopped = reconcileStaleActiveCaptureSessions()
    expect(stopped).toBeGreaterThanOrEqual(1)
    expect(getCaptureSession(session.id)?.status).toBe('stopped')
  })

  it('auto-rehydrates on chunk feed when the in-memory session was lost', async () => {
    const session = await startMeetingCapture({
      tabId: 42,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })

    await stopMeetingCapture(session.id)
    getDbHandle()
      .sqlite.prepare(
        `UPDATE capture_sessions
         SET status = 'active', ended_at = NULL, graph_node_id = NULL
         WHERE id = ?`,
      )
      .run(session.id)

    // No explicit rehydrate — ASR queue restores from DB after persist.
    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('auto-rehydrate'),
    })
    await stopMeetingCapture(session.id)

    const transcript = await readFile(
      getCaptureSession(session.id)?.transcriptPath as string,
      'utf8',
    )
    expect(transcript).toContain('chunk 0')
  })
})
