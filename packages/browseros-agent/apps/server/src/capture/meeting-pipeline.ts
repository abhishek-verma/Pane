/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ByokTranscriptionProvider,
  LocalFasterWhisperProvider,
} from '@browseros/capture/providers'
import type {
  AudioChunk,
  CaptureClass,
  CaptureSessionStatus,
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionSession,
  TranscriptSegment,
} from '@browseros/capture/types'
import { graphAddEvent, graphUpsertNode } from '../context/repo'
import { getCaptureDir } from '../lib/browseros-dir'
import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import { requireCaptureConsent } from './consent'
import { assertCaptureNotPaused, refreshCapturePauseState } from './performance'
import { getCaptureAsrSecret } from './secrets'

/** DB-active meetings older than this with no in-memory recorder are treated as stale. */
const STALE_ACTIVE_SESSION_MS = 6 * 60 * 60 * 1000
/**
 * Active meetings with no uploaded audio after this long are abandoned.
 * Keep short: empty zombies previously crash-looped the server via ASR rehydrate.
 * 60s still leaves room for the first MediaRecorder timeslice (~2s) after start.
 */
const EMPTY_ACTIVE_SESSION_MS = 60 * 1000

export interface CaptureSessionSummary {
  id: string
  bucketId: string
  kind: CaptureClass
  tabId: number | null
  url: string | null
  title: string | null
  status: CaptureSessionStatus
  provider: TranscriptionProviderId
  startedAt: number
  endedAt: number | null
  transcriptPath: string | null
  summaryPath: string | null
  graphNodeId: string | null
}

const activeSessions = new Map<
  string,
  {
    providerSession: TranscriptionSession
    transcriptPath: string
    rawDir: string
  }
>()
const feedQueues = new Map<string, Promise<void>>()

function sqlite() {
  return getDbHandle().sqlite
}

function providerFor(id: TranscriptionProviderId): TranscriptionProvider {
  if (id === 'openai-byok') {
    const apiKey = getCaptureAsrSecret('openai')
    if (!apiKey) {
      throw new Error(
        'OpenAI BYOK transcription requires capture/openai_api_key',
      )
    }
    return new ByokTranscriptionProvider(id, apiKey)
  }
  if (id === 'deepgram-byok') {
    const apiKey = getCaptureAsrSecret('deepgram')
    if (!apiKey) {
      throw new Error(
        'Deepgram BYOK transcription requires capture/deepgram_api_key',
      )
    }
    return new ByokTranscriptionProvider(id, apiKey)
  }
  return new LocalFasterWhisperProvider()
}

export async function startMeetingCapture(input: {
  tabId: number
  bucketId: string
  url: string
  title?: string
  provider?: TranscriptionProviderId
  requireConsent?: boolean
}): Promise<CaptureSessionSummary> {
  await refreshCapturePauseState()
  assertCaptureNotPaused()
  if (input.requireConsent !== false) {
    requireCaptureConsent(input.url, 'meeting')
  }
  const id = crypto.randomUUID()
  const providerId = input.provider ?? 'local-faster-whisper'
  const startedAt = Date.now()
  const sessionDir = join(getCaptureDir(), input.bucketId, 'meetings', id)
  const rawDir = join(sessionDir, 'audio-chunks')
  const transcriptPath = join(sessionDir, 'transcript.jsonl')
  const summaryPath = join(sessionDir, 'summary.md')
  await mkdir(rawDir, { recursive: true })
  await mkdir(join(sessionDir, 'page-snapshots'), { recursive: true })
  await writeFile(
    summaryPath,
    `# Meeting Capture\n\nSummary is pending. Transcript: ${transcriptPath}\n`,
  )
  const providerSession = await providerFor(providerId).startSession({
    sessionId: id,
    onPartial: (segment) => void appendTranscript(transcriptPath, segment),
    onFinal: (segment) => void appendTranscript(transcriptPath, segment),
  })
  activeSessions.set(id, { providerSession, transcriptPath, rawDir })
  sqlite()
    .prepare(
      `INSERT INTO capture_sessions
       (id, bucket_id, kind, tab_id, url, title, status, provider, started_at,
        transcript_path, summary_path)
       VALUES (?, ?, 'meeting', ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.bucketId,
      input.tabId,
      input.url,
      input.title ?? null,
      providerId,
      startedAt,
      transcriptPath,
      summaryPath,
    )
  return getCaptureSession(id) as CaptureSessionSummary
}

/**
 * Rebuild in-memory ASR state for a DB-active session after a server restart.
 * Without this, chunk uploads fail with "Capture session not active" and the
 * meeting produces an empty transcript even though the client is still recording.
 */
async function rehydrateSession(session: CaptureSessionSummary): Promise<{
  providerSession: TranscriptionSession
  transcriptPath: string
  rawDir: string
} | null> {
  if (!session.transcriptPath) return null
  const existing = activeSessions.get(session.id)
  if (existing) return existing

  const sessionDir = session.transcriptPath.replace(/\/transcript\.jsonl$/, '')
  const rawDir = join(sessionDir, 'audio-chunks')
  await mkdir(rawDir, { recursive: true })
  await mkdir(join(sessionDir, 'page-snapshots'), { recursive: true })

  const providerSession = await providerFor(session.provider).startSession({
    sessionId: session.id,
    onPartial: (segment) =>
      void appendTranscript(session.transcriptPath as string, segment),
    onFinal: (segment) =>
      void appendTranscript(session.transcriptPath as string, segment),
  })
  const active = {
    providerSession,
    transcriptPath: session.transcriptPath,
    rawDir,
  }
  activeSessions.set(session.id, active)
  logger.info('Rehydrated capture session after restart', {
    sessionId: session.id,
    provider: session.provider,
  })
  return active
}

/**
 * Re-attach ASR for DB-active meetings that already have audio on disk.
 * Never spawn ASR for empty zombies — that crash-looped the packaged server.
 * Prefer lazy rehydrate via feedCaptureChunk; this exists for tests / recovery tools.
 */
export async function rehydrateActiveCaptureSessions(): Promise<number> {
  const rows = sqlite()
    .prepare<CaptureSessionDbRow, []>(
      `SELECT * FROM capture_sessions WHERE kind = 'meeting' AND status = 'active'`,
    )
    .all()
  let restored = 0
  for (const row of rows) {
    const session = rowToSummary(row)
    if (Date.now() - session.startedAt > STALE_ACTIVE_SESSION_MS) continue
    const sessionDir = session.transcriptPath?.replace(
      /\/transcript\.jsonl$/,
      '',
    )
    const streamPath = sessionDir
      ? join(sessionDir, 'audio-chunks', 'stream.webm')
      : null
    if (!streamPath || !existsSync(streamPath)) {
      logger.info('Skipping rehydrate for empty active capture session', {
        sessionId: session.id,
      })
      continue
    }
    const active = await rehydrateSession(session).catch((err: unknown) => {
      logger.warn('Failed to rehydrate capture session', {
        sessionId: session.id,
        err,
      })
      void failMeetingCapture(
        session.id,
        err instanceof Error ? err.message : String(err),
      ).catch(() => undefined)
      return null
    })
    if (active) restored++
  }
  return restored
}

/** Mark abandoned DB-active meetings as stopped (not mid-call restarts). */
export function reconcileStaleActiveCaptureSessions(now = Date.now()): number {
  const rows = sqlite()
    .prepare<
      { id: string; started_at: number; transcript_path: string | null },
      []
    >(
      `SELECT id, started_at, transcript_path FROM capture_sessions
       WHERE kind = 'meeting' AND status = 'active'`,
    )
    .all()
  let stopped = 0
  for (const row of rows) {
    if (isSessionRecording(row.id)) continue
    const age = now - row.started_at
    const sessionDir = row.transcript_path?.replace(/\/transcript\.jsonl$/, '')
    const streamPath = sessionDir
      ? join(sessionDir, 'audio-chunks', 'stream.webm')
      : null
    const hasAudio = streamPath ? existsSync(streamPath) : false
    const abandonedEmpty = !hasAudio && age >= EMPTY_ACTIVE_SESSION_MS
    const abandonedOld = age >= STALE_ACTIVE_SESSION_MS
    if (!abandonedEmpty && !abandonedOld) continue
    sqlite()
      .prepare(
        `UPDATE capture_sessions SET status = 'stopped', ended_at = ? WHERE id = ?`,
      )
      .run(now, row.id)
    stopped++
  }
  return stopped
}

export async function feedCaptureChunk(input: {
  sessionId: string
  sequence: number
  mimeType: string
  data: Uint8Array
  capturedAt?: number
}): Promise<void> {
  const prior = feedQueues.get(input.sessionId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  feedQueues.set(
    input.sessionId,
    prior.then(() => gate),
  )
  await prior
  try {
    await feedCaptureChunkInner(input)
  } finally {
    release()
    if (feedQueues.get(input.sessionId) === gate) {
      feedQueues.delete(input.sessionId)
    }
  }
}

async function feedCaptureChunkInner(input: {
  sessionId: string
  sequence: number
  mimeType: string
  data: Uint8Array
  capturedAt?: number
}): Promise<void> {
  await refreshCapturePauseState()
  assertCaptureNotPaused()
  let active = activeSessions.get(input.sessionId)
  if (!active) {
    const session = getCaptureSession(input.sessionId)
    if (session?.status === 'active') {
      try {
        active = (await rehydrateSession(session)) ?? undefined
      } catch (err: unknown) {
        logger.warn('Lazy capture rehydrate failed', {
          sessionId: input.sessionId,
          err,
        })
        await failMeetingCapture(
          input.sessionId,
          err instanceof Error ? err.message : String(err),
        ).catch(() => undefined)
        throw err
      }
    }
  }
  if (!active) throw new Error(`Capture session not active: ${input.sessionId}`)
  const chunk: AudioChunk = {
    sessionId: input.sessionId,
    sequence: input.sequence,
    mimeType: input.mimeType,
    data: input.data,
    capturedAt: input.capturedAt ?? Date.now(),
  }
  await writeFile(
    join(active.rawDir, `${String(input.sequence).padStart(8, '0')}.chunk`),
    chunk.data,
  )
  const streamPath = join(active.rawDir, 'stream.webm')
  if (input.sequence === 0) {
    await writeFile(streamPath, chunk.data)
  } else {
    await appendFile(streamPath, chunk.data)
  }
  const decodable = new Uint8Array(await readFile(streamPath))
  await active.providerSession.feedChunk({ ...chunk, data: decodable })
}

export async function appendPageSnapshot(input: {
  sessionId: string
  title?: string
  url?: string
  text: string
  capturedAt?: number
}): Promise<void> {
  const session = getCaptureSession(input.sessionId)
  if (!session?.transcriptPath) throw new Error('capture session not found')
  const sessionDir = session.transcriptPath.replace(/\/transcript\.jsonl$/, '')
  const capturedAt = input.capturedAt ?? Date.now()
  await writeFile(
    join(sessionDir, 'page-snapshots', `${capturedAt}.json`),
    `${JSON.stringify({ ...input, capturedAt }, null, 2)}\n`,
  )
}

export async function stopMeetingCapture(
  sessionId: string,
): Promise<CaptureSessionSummary | null> {
  const active = activeSessions.get(sessionId)
  if (active) {
    await active.providerSession.stop()
    activeSessions.delete(sessionId)
  }
  const session = getCaptureSession(sessionId)
  if (!session) return null
  const endedAt = Date.now()
  const node = graphUpsertNode({
    id: `meeting:${sessionId}`,
    bucketId: session.bucketId,
    kind: 'meeting',
    title: session.title ?? 'Meeting capture',
    uri: session.url,
    summary: `Meeting transcript stored at ${session.transcriptPath}`,
    provenance: 'capture:meeting',
  })
  graphAddEvent({
    bucketId: session.bucketId,
    toolName: 'capture_stop',
    nodeId: node.id,
    payload: { sessionId, url: session.url, endedAt },
  })
  sqlite()
    .prepare(
      `UPDATE capture_sessions
       SET status = 'stopped', ended_at = ?, graph_node_id = ?
       WHERE id = ?`,
    )
    .run(endedAt, node.id, sessionId)
  return getCaptureSession(sessionId)
}

export async function failMeetingCapture(
  sessionId: string,
  errorMessage: string,
): Promise<CaptureSessionSummary | null> {
  const active = activeSessions.get(sessionId)
  if (active) {
    await active.providerSession.stop().catch(() => undefined)
    activeSessions.delete(sessionId)
  }
  const session = getCaptureSession(sessionId)
  if (!session) return null
  const endedAt = Date.now()
  const title = session.title ?? errorMessage.slice(0, 120)
  sqlite()
    .prepare(
      `UPDATE capture_sessions
       SET status = 'error', ended_at = ?, title = ?
       WHERE id = ?`,
    )
    .run(endedAt, title, sessionId)
  return getCaptureSession(sessionId)
}

export function listCaptureSessions(
  input: { bucketId?: string; kind?: CaptureClass } = {},
): CaptureSessionSummary[] {
  const rows = sqlite()
    .prepare<
      CaptureSessionDbRow,
      [string | null, string | null, CaptureClass | null, CaptureClass | null]
    >(
      `SELECT * FROM capture_sessions
       WHERE (? IS NULL OR bucket_id = ?)
         AND (? IS NULL OR kind = ?)
       ORDER BY started_at DESC`,
    )
    .all(
      input.bucketId ?? null,
      input.bucketId ?? null,
      input.kind ?? null,
      input.kind ?? null,
    )
  return rows.map(rowToSummary)
}

export function getCaptureSession(id: string): CaptureSessionSummary | null {
  const row = sqlite()
    .prepare<CaptureSessionDbRow, [string]>(
      `SELECT * FROM capture_sessions WHERE id = ?`,
    )
    .get(id)
  return row ? rowToSummary(row) : null
}

export function activeCaptureSessionCount(): number {
  return activeSessions.size
}

export function isSessionRecording(id: string): boolean {
  return activeSessions.has(id)
}

async function appendTranscript(
  transcriptPath: string,
  segment: TranscriptSegment,
): Promise<void> {
  await appendFile(transcriptPath, `${JSON.stringify(segment)}\n`)
}

interface CaptureSessionDbRow {
  id: string
  bucket_id: string
  kind: CaptureClass
  tab_id: number | null
  url: string | null
  title: string | null
  status: CaptureSessionStatus
  provider: TranscriptionProviderId
  started_at: number
  ended_at: number | null
  transcript_path: string | null
  summary_path: string | null
  graph_node_id: string | null
}

function rowToSummary(row: CaptureSessionDbRow): CaptureSessionSummary {
  return {
    id: row.id,
    bucketId: row.bucket_id,
    kind: row.kind,
    tabId: row.tab_id,
    url: row.url,
    title: row.title,
    status: row.status,
    provider: row.provider,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    transcriptPath: row.transcript_path,
    summaryPath: row.summary_path,
    graphNodeId: row.graph_node_id,
  }
}
