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
  indexMeetingCapture,
  reconcileStaleActiveCaptureSessions,
  rehydrateActiveCaptureSessions,
  reindexPlaceholderMeetingCaptures,
  startMeetingCapture,
  stopMeetingCapture,
} from '../../src/capture/meeting-pipeline'
import { setCapturePausedReason } from '../../src/capture/performance'
import { resetSharedAsrWorkerForTests } from '../../src/capture/shared-asr-worker'
import { recordSpeakerObservation } from '../../src/capture/speaker-timeline'
import { buildCaptureToolSet } from '../../src/capture/tools'
import { setPauseOnBatteryPref } from '../../src/context/battery'
import { graphSearch } from '../../src/context/repo'
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

    const summaryPath = getCaptureSession(session.id)?.summaryPath
    expect(summaryPath).toBeTruthy()
    const summaryMd = await readFile(summaryPath as string, 'utf8')
    expect(summaryMd).toContain('## Excerpt')
    expect(summaryMd).not.toContain('Summary is pending')
    expect(summaryMd).toContain('chunk 0')

    const hits = graphSearch('default', 'chunk', 5)
    expect(hits.some((h) => h.kind === 'meeting')).toBe(true)

    const tools = buildCaptureToolSet(() => 'default')
    expect(tools.capture_start).toBeDefined()
    const inProcessTools = buildCaptureToolSet(() => 'default', {
      includeStartTool: false,
    })
    expect(inProcessTools.capture_start).toBeUndefined()

    const readResult = await tools.capture_read.execute?.(
      { sessionId: session.id },
      { toolCallId: 't1', messages: [] },
    )
    expect(readResult).toEqual(
      expect.objectContaining({
        text: expect.stringContaining('chunk 0'),
      }),
    )
    expect((readResult as { text: string }).text).toContain('## Transcript')
    expect((readResult as { text: string }).text).toContain(
      'Local excerpt / metadata',
    )
    expect((readResult as { text: string }).text).not.toContain(
      'Summary is pending',
    )
  })

  it('reindexes placeholder meeting graph summaries', async () => {
    const session = await startMeetingCapture({
      tabId: 43,
      bucketId: 'default',
      url: 'https://meet.google.com/xyz-abcd-efg',
      title: 'Retro',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })
    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('fake-audio'),
    })
    await stopMeetingCapture(session.id)

    // Simulate legacy path-only index.
    const { getDbHandle } = await import('../../src/lib/db')
    getDbHandle()
      .sqlite.prepare(`UPDATE graph_nodes SET summary = ? WHERE id = ?`)
      .run(
        `Meeting transcript stored at /tmp/fake/transcript.jsonl`,
        `meeting:${session.id}`,
      )

    const count = await reindexPlaceholderMeetingCaptures()
    expect(count).toBeGreaterThanOrEqual(1)
    const again = await indexMeetingCapture(session.id)
    expect(again?.graphNodeId).toBe(`meeting:${session.id}`)
    const hits = graphSearch('default', 'chunk', 5)
    expect(hits.some((h) => h.nodeId === `meeting:${session.id}`)).toBe(true)
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

  it('stamps speaker from timeline onto ASR finals (B-T4)', async () => {
    const session = await startMeetingCapture({
      tabId: 42,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })
    expect(session.site).toBe('meet')

    recordSpeakerObservation(session.id, {
      displayName: 'Ada',
      confidence: 0.9,
      observedAt: Date.now(),
      source: 'dom-active',
    })

    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('fake-audio'),
      capturedAt: Date.now(),
    })
    await stopMeetingCapture(session.id)

    const transcript = await readFile(
      getCaptureSession(session.id)?.transcriptPath as string,
      'utf8',
    )
    expect(transcript).toContain('"speaker":"Ada"')
  })

  it('labels tab-track segments as "other" when no observation (B-T6)', async () => {
    const session = await startMeetingCapture({
      tabId: 42,
      bucketId: 'default',
      url: 'https://meet.google.com/abc-defg-hij',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })

    await feedCaptureChunk({
      sessionId: session.id,
      sequence: 0,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('fake-audio'),
    })
    await stopMeetingCapture(session.id)

    const transcript = await readFile(
      getCaptureSession(session.id)?.transcriptPath as string,
      'utf8',
    )
    expect(transcript).toContain('chunk 0')
    expect(transcript).toContain('"speaker":"other"')
  })

  it('accepts generic site when domain is allowlisted (A-T6)', async () => {
    setCaptureConsent({
      domain: 'example.com',
      class: 'meeting',
      allowed: true,
    })
    const session = await startMeetingCapture({
      tabId: 7,
      bucketId: 'default',
      url: 'https://example.com/room/xyz',
      provider: 'local-faster-whisper',
      requireConsent: true,
    })
    expect(session.site).toBe('generic')
    expect(session.roomKey).toBe('generic:example.com/room/xyz')
    await stopMeetingCapture(session.id)
  })
})
