/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * One supervised local ASR child multiplexed across capture sessions.
 * Fair equal-weight deficit round-robin; serial Whisper inference.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  localAsrSidecarEnv,
  resolveLocalAsrSidecar,
} from '@browseros/capture/providers'
import type { TranscriptSegment } from '@browseros/capture/types'
import { logger } from '../lib/logger'

export type AsrJob = {
  sessionId: string
  sequence: number
  audioPath: string
  capturedAt: number
  mimeType: string
  force?: boolean
}

type SessionCallbacks = {
  onPartial: (segment: TranscriptSegment) => void
  onFinal: (segment: TranscriptSegment) => void
  onGap?: (segment: TranscriptSegment) => void
}

type SessionState = {
  callbacks: SessionCallbacks
  backlog: AsrJob[]
  deficit: number
  registered: boolean
}

const WEIGHT = 1
// A window is at most 24s of audio; Metal-accelerated Whisper inference on
// that should never come close to this. Guards against the native call
// hanging (not crashing — a crash already resolves via the 'exit' handler)
// and wedging the single shared worker for every session indefinitely.
const JOB_TIMEOUT_MS = 45_000

let child: ChildProcessWithoutNullStreams | null = null
let ready = false
let starting: Promise<void> | null = null
let inflight: {
  sessionId: string
  sequence: number
  resolve: () => void
  reject: (err: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
} | null = null

const sessions = new Map<string, SessionState>()
let scheduling = false

function send(obj: Record<string, unknown>): void {
  if (!child?.stdin.writable) {
    throw new Error('ASR worker stdin not writable')
  }
  child.stdin.write(`${JSON.stringify(obj)}\n`)
}

async function ensureWorker(): Promise<void> {
  if (ready && child && child.exitCode === null) return
  if (starting) {
    await starting
    return
  }
  starting = (async () => {
    await spawnWorker()
  })()
  try {
    await starting
  } finally {
    starting = null
  }
}

async function spawnWorker(): Promise<void> {
  ready = false
  if (child) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    child = null
  }
  const { command, args } = resolveLocalAsrSidecar()
  const spawned = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: localAsrSidecarEnv(),
  })
  child = spawned
  // A killed-and-superseded child (e.g. the job-timeout respawn below, or a
  // fresh spawnWorker() call from a test reset) still fires its exit/error
  // events asynchronously after `child` has already moved on to a newer
  // process. Without this guard, that stale event would rejectInflight()
  // the *new* child's in-flight job and null out live worker state.
  spawned.stdin.on('error', (err) => {
    if (child !== spawned) return
    logger.warn('ASR worker stdin error', { err })
    rejectInflight(err instanceof Error ? err : new Error(String(err)))
  })
  spawned.on('error', (err) => {
    if (child !== spawned) return
    logger.warn('ASR worker process error', { err })
    ready = false
    rejectInflight(err instanceof Error ? err : new Error(String(err)))
  })
  spawned.on('exit', (code) => {
    if (child !== spawned) return
    logger.warn('ASR worker exited', { code })
    ready = false
    rejectInflight(new Error(`ASR worker exited with code ${code}`))
    child = null
    // Respawn lazily on next feed
  })
  spawned.stderr.on('data', (buf: Buffer) => {
    process.stderr.write(buf)
  })

  const rl = createInterface({ input: spawned.stdout })
  const readyWait = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('ASR worker ready timeout')),
      120_000,
    )
    const onLine = (line: string) => {
      if (!line.trim()) return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(line) as Record<string, unknown>
      } catch {
        return
      }
      handleWorkerMessage(msg)
      if (msg.kind === 'ready' || process.env.BROWSEROS_ASR_MOCK === '1') {
        clearTimeout(timer)
        ready = true
        resolve()
      }
    }
    rl.on('line', onLine)
    // Mock mode emits no ready — treat first spawn as ready immediately
    if (process.env.BROWSEROS_ASR_MOCK === '1') {
      clearTimeout(timer)
      ready = true
      resolve()
    }
  })
  await readyWait
  logger.info('Shared ASR worker ready')
}

function rejectInflight(err: Error): void {
  if (!inflight) return
  clearTimeout(inflight.timeoutHandle)
  const { sessionId, sequence, reject } = inflight
  inflight = null
  // Without this, the caller's enqueueAsrJob() promise — which only
  // resolves on an 'ack' that will now never arrive — hangs forever even
  // though the scheduler itself has moved on.
  rejectJobWaiters(sessionId, sequence, err)
  reject(err)
}

function handleWorkerMessage(msg: Record<string, unknown>): void {
  const kind = String(msg.kind ?? '')
  const sessionId = String(msg.sessionId ?? '')
  const session = sessions.get(sessionId)

  if (kind === 'ack') {
    const sequence = Number(msg.sequence)
    resolveJobWaiters(sessionId, sequence)
    if (
      inflight &&
      inflight.sessionId === sessionId &&
      inflight.sequence === sequence
    ) {
      clearTimeout(inflight.timeoutHandle)
      inflight.resolve()
      inflight = null
      void pumpScheduler()
    }
    return
  }

  if ((kind === 'final' || kind === 'partial') && session) {
    const segment: TranscriptSegment = {
      id: String(msg.id ?? crypto.randomUUID()),
      sessionId,
      kind: kind === 'partial' ? 'partial' : 'final',
      text: String(msg.text ?? ''),
      capturedAt: Number(msg.capturedAt ?? Date.now()),
      speaker:
        typeof msg.speaker === 'string' ? (msg.speaker as string) : undefined,
      confidence:
        typeof msg.confidence === 'number'
          ? (msg.confidence as number)
          : undefined,
    }
    if (kind === 'partial') session.callbacks.onPartial(segment)
    else session.callbacks.onFinal(segment)
  }
}

async function pumpScheduler(): Promise<void> {
  if (scheduling || inflight) return
  scheduling = true
  try {
    while (!inflight) {
      const job = pickNextJob()
      if (!job) break
      await ensureWorker()
      await runJob(job)
    }
  } finally {
    scheduling = false
  }
}

function pickNextJob(): AsrJob | null {
  let best: { sessionId: string; job: AsrJob; deficit: number } | null = null
  for (const [sessionId, state] of sessions) {
    if (!state.registered || state.backlog.length === 0) continue
    if (!best || state.deficit > best.deficit) {
      best = { sessionId, job: state.backlog[0]!, deficit: state.deficit }
    }
  }
  if (!best) return null
  const state = sessions.get(best.sessionId)!
  state.backlog.shift()
  state.deficit -= WEIGHT
  // Keep deficits non-negative relative: bump all when all zero
  if ([...sessions.values()].every((s) => s.deficit <= 0)) {
    for (const s of sessions.values()) s.deficit += WEIGHT
  }
  return best.job
}

function runJob(job: AsrJob): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      logger.warn('ASR worker job timed out; restarting worker', {
        sessionId: job.sessionId,
        sequence: job.sequence,
      })
      rejectInflight(new Error('Transcription timed out, please retry'))
      // A hung native call can't be un-stuck in place — only a fresh
      // process recovers the shared worker for every other session too.
      void spawnWorker()
        .then(() => pumpScheduler())
        .catch((err) => {
          logger.warn('ASR worker respawn after stuck job failed', { err })
        })
    }, JOB_TIMEOUT_MS)

    inflight = {
      sessionId: job.sessionId,
      sequence: job.sequence,
      resolve,
      reject,
      timeoutHandle,
    }
    try {
      send({
        op: 'feed',
        sessionId: job.sessionId,
        sequence: job.sequence,
        mimeType: job.mimeType,
        capturedAt: job.capturedAt,
        audioPath: job.audioPath,
        force: job.force === true,
      })
    } catch (err) {
      clearTimeout(timeoutHandle)
      inflight = null
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export async function registerAsrSession(
  sessionId: string,
  callbacks: SessionCallbacks,
): Promise<void> {
  const existing = sessions.get(sessionId)
  if (existing) {
    existing.callbacks = callbacks
    existing.registered = true
    return
  }
  sessions.set(sessionId, {
    callbacks,
    backlog: [],
    deficit: WEIGHT,
    registered: true,
  })
  await ensureWorker().catch((err) => {
    logger.warn('ASR worker warm failed; will retry on feed', { err })
  })
  try {
    if (ready) send({ op: 'register', sessionId })
  } catch {
    /* retry on feed */
  }
}

export async function unregisterAsrSession(sessionId: string): Promise<void> {
  const state = sessions.get(sessionId)
  if (!state) return
  state.registered = false
  state.backlog.length = 0
  try {
    if (ready) send({ op: 'unregister', sessionId })
  } catch {
    /* ignore */
  }
  sessions.delete(sessionId)
}

const jobWaiters = new Map<
  string,
  Array<{ resolve: () => void; reject: (err: Error) => void }>
>()

function jobKey(sessionId: string, sequence: number): string {
  return `${sessionId}:${sequence}`
}

export function enqueueAsrJob(job: AsrJob): Promise<void> {
  const state = sessions.get(job.sessionId)
  if (!state?.registered) {
    logger.warn('ASR enqueue for unregistered session', {
      sessionId: job.sessionId,
    })
    return Promise.resolve()
  }
  const done = new Promise<void>((resolve, reject) => {
    const key = jobKey(job.sessionId, job.sequence)
    const list = jobWaiters.get(key) ?? []
    list.push({ resolve, reject })
    jobWaiters.set(key, list)
  })
  state.backlog.push(job)
  state.deficit += WEIGHT
  void pumpScheduler().catch((err) => {
    logger.warn('ASR scheduler error', { err })
  })
  return done
}

function resolveJobWaiters(sessionId: string, sequence: number): void {
  const key = jobKey(sessionId, sequence)
  const list = jobWaiters.get(key)
  if (!list) return
  jobWaiters.delete(key)
  for (const waiter of list) waiter.resolve()
}

function rejectJobWaiters(
  sessionId: string,
  sequence: number,
  err: Error,
): void {
  const key = jobKey(sessionId, sequence)
  const list = jobWaiters.get(key)
  if (!list) return
  jobWaiters.delete(key)
  for (const waiter of list) waiter.reject(err)
}

export async function drainAsrSession(sessionId: string): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const state = sessions.get(sessionId)
    const pending =
      (state?.backlog.length ?? 0) > 0 || inflight?.sessionId === sessionId
    if (!pending) return
    await new Promise((r) => setTimeout(r, 50))
  }
}

export function registeredAsrSessionCount(): number {
  let n = 0
  for (const s of sessions.values()) if (s.registered) n++
  return n
}

export function isAsrBacklogged(sessionId: string): boolean {
  const state = sessions.get(sessionId)
  return Boolean(state && state.backlog.length > 0)
}

/** Test helper: clear in-memory worker state between cases. */
export function resetSharedAsrWorkerForTests(): void {
  sessions.clear()
  jobWaiters.clear()
  if (inflight) clearTimeout(inflight.timeoutHandle)
  inflight = null
  scheduling = false
  ready = false
  if (child) {
    try {
      child.kill('SIGTERM')
    } catch {
      /* ignore */
    }
    child = null
  }
  starting = null
}
