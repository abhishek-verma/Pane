/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { detectMeetingRoomForCapture } from '@browseros/capture/meeting-urls'
import { ByokTranscriptionProvider } from '@browseros/capture/providers'
import type {
  AudioChunk,
  CaptureAudioTrack,
  CaptureClass,
  CaptureSessionStatus,
  MeetingSite,
  TranscriptionProviderId,
  TranscriptSegment,
} from '@browseros/capture/types'
import { graphAddEvent, graphUpsertNode } from '../context/repo'
import { getCaptureDir } from '../lib/browseros-dir'
import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import { listCaptureConsents, requireCaptureConsent } from './consent'
import {
  assertCanStartNewCapture,
  isAsrDeferredGlobally,
  refreshCapturePauseState,
} from './performance'
import { getCaptureAsrSecret } from './secrets'
import {
  drainAsrSession,
  enqueueAsrJob,
  registerAsrSession,
  registeredAsrSessionCount,
  unregisterAsrSession,
} from './shared-asr-worker'
import {
  bindSpeakerTimelineSession,
  clearSpeakerTimeline,
  resolveSpeakerAt,
} from './speaker-timeline'
import {
  buildMeetingGraphSummary,
  isPlaceholderMeetingGraphSummary,
  loadFormattedTranscript,
  writeMeetingSummaryFile,
} from './transcript-access'
import { publishCaptureEvent } from './transcript-events'
import { estimateChunkEnergy, noteAsrText, shouldEnqueueAsr } from './vad'

/** DB-active meetings older than this with no in-memory recorder are treated as stale. */
const STALE_ACTIVE_SESSION_MS = 6 * 60 * 60 * 1000
const EMPTY_ACTIVE_SESSION_MS = 60 * 1000
/** Resume TTL for interrupted sessions (roomKey lookup). */
export const ROOM_RESUME_TTL_MS = 45 * 60 * 1000

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
  site: MeetingSite | null
  roomKey: string | null
  lastChunkAt: number | null
  asrWatermarkPcm: number
  lastAsrSequence: number
  includeMic: boolean
  asrDeferred?: boolean
}

type RegisteredSession = {
  transcriptPath: string
  rawDir: string
  provider: TranscriptionProviderId
  byokSession?: {
    feedChunk: (chunk: AudioChunk) => Promise<void>
    stop: () => Promise<void>
  }
}

const registeredSessions = new Map<string, RegisteredSession>()
/** Guards against reconciler deleting sessions mid-initialization. */
const sessionsInitializing = new Set<string>()
const feedQueues = new Map<string, Promise<void>>()
/** Per-session ASR task chain (ordering); jobs go to fair shared worker. */
const asrQueues = new Map<string, Promise<void>>()

function sqlite() {
  return getDbHandle().sqlite
}

function byokProvider(id: 'openai-byok' | 'deepgram-byok') {
  const apiKey =
    id === 'openai-byok'
      ? getCaptureAsrSecret('openai')
      : getCaptureAsrSecret('deepgram')
  if (!apiKey) {
    throw new Error(`${id} transcription requires capture API key`)
  }
  return new ByokTranscriptionProvider(id, apiKey)
}

async function writeAsrState(
  sessionDir: string,
  state: {
    lastContiguousSequence: number
    asrPcmOffset: number
    lastFinalAt: number
  },
): Promise<void> {
  const path = join(sessionDir, 'asr-state.json')
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`)
}

async function readAsrState(sessionDir: string): Promise<{
  lastContiguousSequence: number
  asrPcmOffset: number
} | null> {
  try {
    const raw = await readFile(join(sessionDir, 'asr-state.json'), 'utf8')
    const parsed = JSON.parse(raw) as {
      lastContiguousSequence?: number
      asrPcmOffset?: number
    }
    return {
      lastContiguousSequence: parsed.lastContiguousSequence ?? -1,
      asrPcmOffset: parsed.asrPcmOffset ?? 0,
    }
  } catch {
    return null
  }
}

export async function startMeetingCapture(input: {
  tabId: number
  bucketId: string
  url: string
  title?: string
  provider?: TranscriptionProviderId
  requireConsent?: boolean
  includeMic?: boolean
  resumeSessionId?: string
}): Promise<CaptureSessionSummary> {
  await refreshCapturePauseState()
  if (input.requireConsent !== false) {
    requireCaptureConsent(input.url, 'meeting')
  }

  const allowedHosts = listCaptureConsents()
    .filter((c) => c.class === 'meeting' && c.allowed)
    .map((c) => c.domain)
  const detected = detectMeetingRoomForCapture(input.url, allowedHosts)
  const site = detected?.site ?? null
  const roomKey = detected?.roomKey ?? null

  // Sticky / roomKey resume — allowed even when new sessions are refused.
  if (input.resumeSessionId) {
    const existing = getCaptureSession(input.resumeSessionId)
    if (
      existing &&
      (existing.status === 'active' ||
        existing.status === 'interrupted' ||
        existing.status === 'paused')
    ) {
      return resumeMeetingCapture({
        sessionId: existing.id,
        tabId: input.tabId,
        url: input.url,
        title: input.title,
      })
    }
  }
  if (roomKey && site) {
    const resumable = findResumableSession({
      bucketId: input.bucketId,
      site,
      roomKey,
    })
    if (resumable) {
      return resumeMeetingCapture({
        sessionId: resumable.id,
        tabId: input.tabId,
        url: input.url,
        title: input.title,
      })
    }
  }

  assertCanStartNewCapture()

  const id = crypto.randomUUID()
  sessionsInitializing.add(id)
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
  await writeAsrState(sessionDir, {
    lastContiguousSequence: -1,
    asrPcmOffset: 0,
    lastFinalAt: 0,
  })

  const includeMic = input.includeMic !== false ? 1 : 0
  sqlite()
    .prepare(
      `INSERT INTO capture_sessions
       (id, bucket_id, kind, tab_id, url, title, status, provider, started_at,
        transcript_path, summary_path, site, room_key, last_chunk_at,
        asr_watermark_pcm, last_asr_sequence, include_mic)
       VALUES (?, ?, 'meeting', ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 0, -1, ?)`,
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
      site,
      roomKey,
      startedAt,
      includeMic,
    )

  await attachSessionRuntime({
    id,
    provider: providerId,
    transcriptPath,
    rawDir,
  })

  publishCaptureEvent(id, {
    type: 'status',
    sessionId: id,
    status: 'active',
  })
  void import('../personal-internet/refresh/clock')
    .then(({ dispatchPreEvent }) => {
      dispatchPreEvent({
        meetingTitle: (input.title ?? 'Meeting').trim() || 'Meeting',
        startsAtIso: new Date(startedAt).toISOString(),
        sessionId: id,
      })
    })
    .catch(() => undefined)
  sessionsInitializing.delete(id)
  return getCaptureSession(id) as CaptureSessionSummary
}

function stampSpeaker(
  sessionId: string,
  segment: TranscriptSegment,
): TranscriptSegment {
  if (segment.speaker || segment.kind === 'gap') return segment
  const hit = resolveSpeakerAt(sessionId, segment.capturedAt)
  if (!hit) return segment
  return {
    ...segment,
    speaker: hit.isLocalSelf ? hit.displayName || 'You' : hit.displayName,
    confidence: segment.confidence ?? hit.confidence,
  }
}

async function attachSessionRuntime(input: {
  id: string
  provider: TranscriptionProviderId
  transcriptPath: string
  rawDir: string
}): Promise<void> {
  const sessionDir = input.transcriptPath.replace(/\/transcript\.jsonl$/, '')
  bindSpeakerTimelineSession(input.id, sessionDir)

  const onSegment = (segment: TranscriptSegment) => {
    const labeled = stampSpeaker(input.id, segment)
    void appendTranscript(input.transcriptPath, labeled).then(() => {
      publishCaptureEvent(input.id, { type: 'segment', segment: labeled })
    })
  }

  if (input.provider === 'local-faster-whisper') {
    await registerAsrSession(input.id, {
      onPartial: onSegment,
      onFinal: (segment) => {
        onSegment(segment)
        const sessionDir = input.transcriptPath.replace(
          /\/transcript\.jsonl$/,
          '',
        )
        void touchWatermark(input.id, sessionDir, segment)
      },
    })
    registeredSessions.set(input.id, {
      transcriptPath: input.transcriptPath,
      rawDir: input.rawDir,
      provider: input.provider,
    })
    return
  }

  const provider = byokProvider(input.provider)
  const byokSession = await provider.startSession({
    sessionId: input.id,
    onPartial: onSegment,
    onFinal: onSegment,
  })
  registeredSessions.set(input.id, {
    transcriptPath: input.transcriptPath,
    rawDir: input.rawDir,
    provider: input.provider,
    byokSession,
  })
}

async function touchWatermark(
  sessionId: string,
  sessionDir: string,
  segment: TranscriptSegment,
): Promise<void> {
  const state = await readAsrState(sessionDir)
  const lastSeq = state?.lastContiguousSequence ?? -1
  sqlite()
    .prepare(
      `UPDATE capture_sessions SET asr_watermark_pcm = asr_watermark_pcm WHERE id = ?`,
    )
    .run(sessionId)
  await writeAsrState(sessionDir, {
    lastContiguousSequence: lastSeq,
    asrPcmOffset: state?.asrPcmOffset ?? 0,
    lastFinalAt: segment.capturedAt,
  })
}

export function findResumableSession(input: {
  bucketId: string
  site: MeetingSite
  roomKey: string
  now?: number
}): CaptureSessionSummary | null {
  const now = input.now ?? Date.now()
  const row = sqlite()
    .prepare<CaptureSessionDbRow, [string, string, string, number]>(
      `SELECT * FROM capture_sessions
       WHERE bucket_id = ? AND site = ? AND room_key = ?
         AND status IN ('active', 'interrupted', 'paused')
         AND COALESCE(last_chunk_at, started_at) >= ?
       ORDER BY COALESCE(last_chunk_at, started_at) DESC
       LIMIT 1`,
    )
    .get(input.bucketId, input.site, input.roomKey, now - ROOM_RESUME_TTL_MS)
  return row ? rowToSummary(row) : null
}

export async function resumeMeetingCapture(input: {
  sessionId: string
  tabId: number
  url?: string
  title?: string
}): Promise<CaptureSessionSummary> {
  const session = getCaptureSession(input.sessionId)
  if (!session?.transcriptPath) {
    throw new Error(`Capture session not resumable: ${input.sessionId}`)
  }
  const sessionDir = session.transcriptPath.replace(/\/transcript\.jsonl$/, '')
  const rawDir = join(sessionDir, 'audio-chunks')
  await mkdir(rawDir, { recursive: true })

  const gap: TranscriptSegment = {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    kind: 'gap',
    capturedAt: Date.now(),
    reason: 'interrupted_resume',
    resumeSequence: (session.lastAsrSequence ?? -1) + 1,
  }
  await appendTranscript(session.transcriptPath, gap)
  publishCaptureEvent(input.sessionId, { type: 'gap', segment: gap })

  sqlite()
    .prepare(
      `UPDATE capture_sessions
       SET status = 'active', tab_id = ?, url = COALESCE(?, url),
           title = COALESCE(?, title), ended_at = NULL
       WHERE id = ?`,
    )
    .run(input.tabId, input.url ?? null, input.title ?? null, input.sessionId)

  if (!registeredSessions.has(input.sessionId)) {
    await attachSessionRuntime({
      id: input.sessionId,
      provider: session.provider,
      transcriptPath: session.transcriptPath,
      rawDir,
    })
  }

  publishCaptureEvent(input.sessionId, {
    type: 'status',
    sessionId: input.sessionId,
    status: 'active',
  })
  return getCaptureSession(input.sessionId) as CaptureSessionSummary
}

export async function interruptMeetingCapture(
  sessionId: string,
): Promise<CaptureSessionSummary | null> {
  await drainAsrQueue(sessionId)
  await flushAsrRemainder(sessionId)
  const session = getCaptureSession(sessionId)
  if (!session) return null
  if (session.status === 'stopped' || session.status === 'error') return session

  const reg = registeredSessions.get(sessionId)
  if (reg?.byokSession) {
    await reg.byokSession.stop().catch(() => undefined)
  }
  await unregisterAsrSession(sessionId)
  registeredSessions.delete(sessionId)
  await unregisterMicAsrSession(sessionId)
  clearSpeakerTimeline(sessionId)

  sqlite()
    .prepare(`UPDATE capture_sessions SET status = 'interrupted' WHERE id = ?`)
    .run(sessionId)
  publishCaptureEvent(sessionId, {
    type: 'status',
    sessionId,
    status: 'interrupted',
  })
  return getCaptureSession(sessionId)
}

export async function pauseMeetingCapture(
  sessionId: string,
): Promise<CaptureSessionSummary | null> {
  sqlite()
    .prepare(`UPDATE capture_sessions SET status = 'paused' WHERE id = ?`)
    .run(sessionId)
  publishCaptureEvent(sessionId, {
    type: 'status',
    sessionId,
    status: 'paused',
  })
  return getCaptureSession(sessionId)
}

export async function unpauseMeetingCapture(
  sessionId: string,
): Promise<CaptureSessionSummary | null> {
  sqlite()
    .prepare(`UPDATE capture_sessions SET status = 'active' WHERE id = ?`)
    .run(sessionId)
  publishCaptureEvent(sessionId, {
    type: 'status',
    sessionId,
    status: 'active',
  })
  return getCaptureSession(sessionId)
}

/** @deprecated Prefer attach via start/resume — kept for tests. */
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
    if (!streamPath || !existsSync(streamPath)) continue
    if (!session.transcriptPath) continue
    await attachSessionRuntime({
      id: session.id,
      provider: session.provider,
      transcriptPath: session.transcriptPath,
      rawDir: join(sessionDir!, 'audio-chunks'),
    })
    restored++
  }
  return restored
}

export function reconcileStaleActiveCaptureSessions(now = Date.now()): number {
  const rows = sqlite()
    .prepare<
      {
        id: string
        started_at: number
        transcript_path: string | null
        last_chunk_at: number | null
        status: string
      },
      []
    >(
      `SELECT id, started_at, transcript_path, last_chunk_at, status FROM capture_sessions
       WHERE kind = 'meeting' AND status IN ('active', 'interrupted')`,
    )
    .all()
  let stopped = 0
  for (const row of rows) {
    if (isSessionRecording(row.id)) continue
    const age = now - row.started_at
    const last = row.last_chunk_at ?? row.started_at
    const sessionDir = row.transcript_path?.replace(/\/transcript\.jsonl$/, '')
    const streamPath = sessionDir
      ? join(sessionDir, 'audio-chunks', 'stream.webm')
      : null
    const hasAudio = streamPath ? existsSync(streamPath) : false
    const abandonedEmpty = !hasAudio && age >= EMPTY_ACTIVE_SESSION_MS
    const abandonedOld = age >= STALE_ACTIVE_SESSION_MS
    const resumeExpired =
      row.status === 'interrupted' && now - last >= ROOM_RESUME_TTL_MS
    if (!abandonedEmpty && !abandonedOld && !resumeExpired) continue

    if (abandonedEmpty && sessionDir) {
      // Empty sessions (no audio after 60s) — delete entirely.
      sqlite().prepare(`DELETE FROM capture_sessions WHERE id = ?`).run(row.id)
      try {
        const { rmSync } = require('node:fs') as typeof import('node:fs')
        rmSync(sessionDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    } else {
      // Old or resume-expired sessions — stop but keep data
      sqlite()
        .prepare(
          `UPDATE capture_sessions SET status = 'stopped', ended_at = ? WHERE id = ?`,
        )
        .run(now, row.id)
    }
    void unregisterAsrSession(row.id)
    registeredSessions.delete(row.id)
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
  track?: CaptureAudioTrack
}): Promise<void> {
  const track = input.track ?? 'mixed'
  const queueKey = `${input.sessionId}:${track}`
  const prior = feedQueues.get(queueKey) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  feedQueues.set(
    queueKey,
    prior.then(() => gate),
  )
  await prior
  try {
    await feedCaptureChunkInner({ ...input, track })
  } finally {
    release()
    if (feedQueues.get(queueKey) === gate) {
      feedQueues.delete(queueKey)
    }
  }
}

async function feedCaptureChunkInner(input: {
  sessionId: string
  sequence: number
  mimeType: string
  data: Uint8Array
  capturedAt?: number
  track: CaptureAudioTrack
}): Promise<void> {
  await refreshCapturePauseState()
  // Never refuse persist for load/battery — only ASR may defer.

  const session = getCaptureSession(input.sessionId)
  if (
    !session ||
    (session.status !== 'active' &&
      session.status !== 'interrupted' &&
      session.status !== 'paused')
  ) {
    throw new Error(`Capture session not active: ${input.sessionId}`)
  }
  if (session.status === 'paused') {
    throw new Error(`Capture session paused: ${input.sessionId}`)
  }
  if (!session.transcriptPath) {
    throw new Error(
      `Capture session missing transcript path: ${input.sessionId}`,
    )
  }

  const streamPath = await persistCaptureChunkFiles(
    { id: input.sessionId, transcriptPath: session.transcriptPath },
    input,
  )

  const now = input.capturedAt ?? Date.now()
  sqlite()
    .prepare(
      `UPDATE capture_sessions
       SET last_chunk_at = ?, status = CASE WHEN status = 'interrupted' THEN 'active' ELSE status END
       WHERE id = ?`,
    )
    .run(now, input.sessionId)

  if (isAsrDeferredGlobally()) {
    publishCaptureEvent(input.sessionId, {
      type: 'status',
      sessionId: input.sessionId,
      status: session.status,
      asrDeferred: true,
    })
    return
  }

  const energy = estimateChunkEnergy(input.data)
  const vad = shouldEnqueueAsr({
    sessionId: input.sessionId,
    energy,
  })
  if (!vad.enqueue) {
    // Silent slice: keep disk bytes, skip ASR job.
    return
  }

  // Mic uses a parallel ASR session key so incremental watermarks/sequences
  // do not collide with the tab/mixed stream. Segments land in the same
  // transcript with speaker: 'self'.
  if (input.track === 'mic') {
    const micAsrId = micAsrSessionId(input.sessionId)
    enqueueAsrFeed(micAsrId, async () => {
      try {
        await ensureMicAsrSession(input.sessionId)
        await enqueueAsrJob({
          sessionId: micAsrId,
          sequence: input.sequence,
          audioPath: streamPath,
          capturedAt: now,
          mimeType: input.mimeType,
          force: vad.forced,
        })
        noteAsrText(input.sessionId, now)
      } catch (err: unknown) {
        logger.warn('Mic ASR feed failed; audio retained on disk', {
          sessionId: input.sessionId,
          sequence: input.sequence,
          err,
        })
      }
    })
    return
  }

  const chunk: AudioChunk = {
    sessionId: input.sessionId,
    sequence: input.sequence,
    mimeType: input.mimeType,
    data: input.data,
    capturedAt: now,
    track: input.track,
  }

  enqueueAsrFeed(input.sessionId, async () => {
    try {
      let reg = registeredSessions.get(input.sessionId)
      if (!reg) {
        const row = getCaptureSession(input.sessionId)
        if (!row?.transcriptPath) return
        const sessionDir = row.transcriptPath.replace(
          /\/transcript\.jsonl$/,
          '',
        )
        await attachSessionRuntime({
          id: input.sessionId,
          provider: row.provider,
          transcriptPath: row.transcriptPath,
          rawDir: join(sessionDir, 'audio-chunks'),
        })
        reg = registeredSessions.get(input.sessionId)
      }
      if (!reg) return

      if (reg.byokSession) {
        const decodable = new Uint8Array(await readFile(streamPath))
        await reg.byokSession.feedChunk({ ...chunk, data: decodable })
        sqlite()
          .prepare(
            `UPDATE capture_sessions SET last_asr_sequence = ? WHERE id = ?`,
          )
          .run(input.sequence, input.sessionId)
        noteAsrText(input.sessionId, now)
        return
      }

      await enqueueAsrJob({
        sessionId: input.sessionId,
        sequence: input.sequence,
        audioPath: streamPath,
        capturedAt: now,
        mimeType: input.mimeType,
        force: vad.forced,
      })
      sqlite()
        .prepare(
          `UPDATE capture_sessions SET last_asr_sequence = ? WHERE id = ?`,
        )
        .run(input.sequence, input.sessionId)
      const sessionDir = reg.transcriptPath.replace(/\/transcript\.jsonl$/, '')
      const prev = await readAsrState(sessionDir)
      await writeAsrState(sessionDir, {
        lastContiguousSequence: input.sequence,
        asrPcmOffset: prev?.asrPcmOffset ?? 0,
        lastFinalAt: now,
      })
      noteAsrText(input.sessionId, now)
    } catch (err: unknown) {
      logger.warn('ASR rehydrate/feed failed; audio retained on disk', {
        sessionId: input.sessionId,
        sequence: input.sequence,
        err,
      })
    }
  })
}

function micAsrSessionId(sessionId: string): string {
  return `${sessionId}__mic`
}

async function ensureMicAsrSession(parentSessionId: string): Promise<void> {
  const micId = micAsrSessionId(parentSessionId)
  if (registeredSessions.has(micId)) return
  const parent = getCaptureSession(parentSessionId)
  if (!parent?.transcriptPath) return
  const sessionDir = parent.transcriptPath.replace(/\/transcript\.jsonl$/, '')

  const onSegment = (segment: TranscriptSegment) => {
    const labeled: TranscriptSegment = {
      ...segment,
      sessionId: parentSessionId,
      speaker: segment.speaker ?? 'self',
    }
    void appendTranscript(parent.transcriptPath!, labeled).then(() => {
      publishCaptureEvent(parentSessionId, {
        type: 'segment',
        segment: labeled,
      })
    })
  }

  await registerAsrSession(micId, {
    onPartial: onSegment,
    onFinal: onSegment,
  })
  registeredSessions.set(micId, {
    transcriptPath: parent.transcriptPath,
    rawDir: join(sessionDir, 'audio-chunks'),
    provider: parent.provider,
  })
}

async function unregisterMicAsrSession(sessionId: string): Promise<void> {
  const micId = micAsrSessionId(sessionId)
  await unregisterAsrSession(micId)
  registeredSessions.delete(micId)
}

async function persistCaptureChunkFiles(
  session: { id: string; transcriptPath: string | null },
  input: {
    sessionId: string
    sequence: number
    data: Uint8Array
    track: CaptureAudioTrack
  },
): Promise<string> {
  if (!session.transcriptPath) {
    throw new Error(`Capture session missing transcript path: ${session.id}`)
  }
  const sessionDir = session.transcriptPath.replace(/\/transcript\.jsonl$/, '')
  const rawDir = join(sessionDir, 'audio-chunks')
  await mkdir(rawDir, { recursive: true })

  const seqName = `${String(input.sequence).padStart(8, '0')}`
  const chunkName =
    input.track === 'mic' ? `mic-${seqName}.chunk` : `${seqName}.chunk`
  const streamName = input.track === 'mic' ? 'mic-stream.webm' : 'stream.webm'

  await writeFile(join(rawDir, chunkName), input.data)
  const streamPath = join(rawDir, streamName)
  if (input.sequence === 0) {
    await writeFile(streamPath, input.data)
  } else {
    await appendFile(streamPath, input.data)
  }
  return streamPath
}

function enqueueAsrFeed(sessionId: string, task: () => Promise<void>): void {
  const prior = asrQueues.get(sessionId) ?? Promise.resolve()
  const next = prior.then(task, task)
  asrQueues.set(sessionId, next)
  void next.finally(() => {
    if (asrQueues.get(sessionId) === next) {
      asrQueues.delete(sessionId)
    }
  })
}

async function drainAsrQueue(sessionId: string): Promise<void> {
  const pending = asrQueues.get(sessionId)
  if (pending) await pending.catch(() => undefined)
  await drainAsrSession(sessionId)
  const micId = micAsrSessionId(sessionId)
  const micPending = asrQueues.get(micId)
  if (micPending) await micPending.catch(() => undefined)
  await drainAsrSession(micId)
}

/** Force-decode any audio still below the sidecar min-window threshold. */
async function flushAsrRemainder(sessionId: string): Promise<void> {
  const session = getCaptureSession(sessionId)
  if (!session?.transcriptPath) return
  const sessionDir = session.transcriptPath.replace(/\/transcript\.jsonl$/, '')
  const streamPath = join(sessionDir, 'audio-chunks', 'stream.webm')
  if (!existsSync(streamPath)) return
  if (!registeredSessions.has(sessionId)) return
  const sequence = (session.lastAsrSequence ?? -1) + 1
  try {
    await enqueueAsrJob({
      sessionId,
      sequence,
      audioPath: streamPath,
      capturedAt: Date.now(),
      mimeType: 'audio/webm',
      force: true,
    })
    await drainAsrSession(sessionId)
  } catch (err: unknown) {
    logger.warn('ASR flush on stop failed', { sessionId, err })
  }
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
  await drainAsrQueue(sessionId)
  await flushAsrRemainder(sessionId)
  const reg = registeredSessions.get(sessionId)
  if (reg?.byokSession) {
    await reg.byokSession.stop().catch(() => undefined)
  }
  await unregisterAsrSession(sessionId)
  registeredSessions.delete(sessionId)
  await unregisterMicAsrSession(sessionId)
  clearSpeakerTimeline(sessionId)

  const session = getCaptureSession(sessionId)
  if (!session) return null
  const endedAt = Date.now()
  sqlite()
    .prepare(
      `UPDATE capture_sessions
       SET status = 'stopped', ended_at = ?
       WHERE id = ?`,
    )
    .run(endedAt, sessionId)

  const indexed = await indexMeetingCapture(sessionId)
  publishCaptureEvent(sessionId, {
    type: 'status',
    sessionId,
    status: 'stopped',
  })
  void import('../personal-internet/refresh/bus')
    .then(({ dispatchTrigger }) => {
      dispatchTrigger({
        triggerName: 'meeting-ended',
        filterValue: sessionId,
      })
    })
    .catch(() => undefined)
  return indexed ?? getCaptureSession(sessionId)
}

/**
 * Write summary.md + graph FTS text from the on-disk transcript.
 * Safe to call repeatedly for reindexing placeholder nodes.
 */
export async function indexMeetingCapture(
  sessionId: string,
): Promise<CaptureSessionSummary | null> {
  const session = getCaptureSession(sessionId)
  if (!session) return null

  const formatted = await loadFormattedTranscript(session)
  await writeMeetingSummaryFile(
    session,
    formatted.text,
    formatted.segmentCount,
    formatted.truncated,
  ).catch((err) => {
    logger.warn('Failed to write meeting summary.md', {
      sessionId,
      err: String(err),
    })
  })

  const summary = buildMeetingGraphSummary({
    session,
    transcriptText: formatted.text,
    segmentCount: formatted.segmentCount,
  })
  const node = graphUpsertNode({
    id: `meeting:${sessionId}`,
    bucketId: session.bucketId,
    kind: 'meeting',
    title: session.title ?? 'Meeting capture',
    uri: session.url,
    summary,
    provenance: 'capture:meeting',
  })
  graphAddEvent({
    bucketId: session.bucketId,
    toolName: 'capture_index',
    nodeId: node.id,
    payload: {
      sessionId,
      url: session.url,
      segmentCount: formatted.segmentCount,
    },
  })
  sqlite()
    .prepare(`UPDATE capture_sessions SET graph_node_id = ? WHERE id = ?`)
    .run(node.id, sessionId)
  return getCaptureSession(sessionId)
}

/** Reindex stopped meetings whose graph summary is still a path placeholder. */
export async function reindexPlaceholderMeetingCaptures(): Promise<number> {
  const sessions = listCaptureSessions({ kind: 'meeting' })
  let count = 0
  for (const session of sessions) {
    if (session.status === 'active') continue
    const nodeId = session.graphNodeId ?? `meeting:${session.id}`
    const row = sqlite()
      .prepare<{ summary: string | null }, [string]>(
        `SELECT summary FROM graph_nodes WHERE id = ?`,
      )
      .get(nodeId)
    const needsIndex =
      !row ||
      isPlaceholderMeetingGraphSummary(row.summary) ||
      !session.graphNodeId
    if (!needsIndex) continue
    await indexMeetingCapture(session.id)
    count++
  }
  return count
}

export async function failMeetingCapture(
  sessionId: string,
  errorMessage: string,
): Promise<CaptureSessionSummary | null> {
  await drainAsrQueue(sessionId)
  const reg = registeredSessions.get(sessionId)
  if (reg?.byokSession) {
    await reg.byokSession.stop().catch(() => undefined)
  }
  await unregisterAsrSession(sessionId)
  registeredSessions.delete(sessionId)
  await unregisterMicAsrSession(sessionId)
  clearSpeakerTimeline(sessionId)

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
  publishCaptureEvent(sessionId, {
    type: 'status',
    sessionId,
    status: 'error',
  })
  return getCaptureSession(sessionId)
}

export async function deleteMeetingCapture(
  sessionId: string,
): Promise<boolean> {
  await failMeetingCapture(sessionId, 'deleted').catch(() => undefined)
  const session = getCaptureSession(sessionId)
  if (!session) {
    sqlite().prepare(`DELETE FROM capture_sessions WHERE id = ?`).run(sessionId)
    return true
  }
  if (session.transcriptPath) {
    const sessionDir = session.transcriptPath.replace(
      /\/transcript\.jsonl$/,
      '',
    )
    await rm(sessionDir, { recursive: true, force: true }).catch(
      () => undefined,
    )
  }
  sqlite().prepare(`DELETE FROM capture_sessions WHERE id = ?`).run(sessionId)
  return true
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
  return registeredAsrSessionCount() || registeredSessions.size
}

export function isSessionRecording(id: string): boolean {
  return registeredSessions.has(id) || sessionsInitializing.has(id)
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
  site: string | null
  room_key: string | null
  last_chunk_at: number | null
  asr_watermark_pcm: number | null
  last_asr_sequence: number | null
  include_mic: number | null
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
    site: (row.site as MeetingSite | null) ?? null,
    roomKey: row.room_key,
    lastChunkAt: row.last_chunk_at,
    asrWatermarkPcm: row.asr_watermark_pcm ?? 0,
    lastAsrSequence: row.last_asr_sequence ?? -1,
    includeMic: Boolean(row.include_mic),
  }
}
