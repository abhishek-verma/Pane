/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile, writeFile } from 'node:fs/promises'
import type { TranscriptionProviderId } from '@browseros/capture/types'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { ensureAsrModel, getAsrModelStatus } from '../../capture/asr-model'
import {
  observeBrowsingLearning,
  recordResearchPage,
} from '../../capture/browsing-observer'
import { listCaptureConsents, setCaptureConsent } from '../../capture/consent'
import {
  closeDictationSession,
  ensureAsrRegistered,
  getDictationSegments,
  getOrCreateDictationSession,
  nextSequence,
  touchDictationSession,
} from '../../capture/dictation-session'
import {
  appendPageSnapshot,
  deleteMeetingCapture,
  failMeetingCapture,
  feedCaptureChunk,
  getCaptureSession,
  interruptMeetingCapture,
  listCaptureSessions,
  pauseMeetingCapture,
  startMeetingCapture,
  stopMeetingCapture,
  unpauseMeetingCapture,
} from '../../capture/meeting-pipeline'
import {
  getCaptureStatus,
  pruneCaptureRetention,
} from '../../capture/performance'
import {
  enqueueAsrJob,
  registerAsrSession,
  unregisterAsrSession,
} from '../../capture/shared-asr-worker'
import {
  recordSpeakerObservation,
  setSessionParticipants,
} from '../../capture/speaker-timeline'
import {
  getCaptureEventCursor,
  subscribeCaptureEvents,
} from '../../capture/transcript-events'
import type { Env } from '../types'

const CaptureClassSchema = z.enum(['meeting', 'browsing', 'research'])
const ProviderSchema = z.enum([
  'local-faster-whisper',
  'openai-byok',
  'deepgram-byok',
])

const ConsentSchema = z.object({
  domain: z.string().min(1),
  class: CaptureClassSchema,
  bucketId: z.string().optional(),
  allowed: z.boolean(),
})

const StartMeetingSchema = z.object({
  tabId: z.number().int(),
  bucketId: z.string().optional(),
  url: z.string().url(),
  title: z.string().optional(),
  provider: ProviderSchema.optional(),
  requireConsent: z.boolean().optional(),
  includeMic: z.boolean().optional(),
  resumeSessionId: z.string().optional(),
})

const ChunkSchema = z.object({
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
  capturedAt: z.number().optional(),
  track: z.enum(['mixed', 'tab', 'mic']).optional(),
})

const PageSnapshotSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().optional(),
  text: z.string(),
  capturedAt: z.number().optional(),
})

const SpeakerObservationSchema = z.object({
  displayName: z.string().min(1),
  isLocalSelf: z.boolean().optional(),
  confidence: z.number().min(0).max(1),
  observedAt: z.number(),
  source: z.string().min(1),
  localSpeaking: z.boolean().optional(),
  participants: z
    .array(z.object({ displayName: z.string().min(1) }))
    .optional(),
})

const BrowsingObservationSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  text: z.string(),
  bucketId: z.string().optional(),
  capturedAt: z.number().optional(),
})

const ResearchPageSchema = BrowsingObservationSchema.extend({
  threadId: z.string().optional(),
  topic: z.string().optional(),
  quote: z.string().optional(),
})

/**
 * Turns an ASR model download failure into a message worth showing a user.
 * `String(err)` on a fetch TypeError collapses to "TypeError: fetch failed"
 * and drops the underlying cause (e.g. DNS/connection failure), so surface
 * `cause` explicitly when present.
 */
function describeAsrDownloadError(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
          ? cause
          : undefined
    return causeMessage ? `${err.message}: ${causeMessage}` : err.message
  }
  return String(err)
}

export function createCaptureRoutes() {
  return (
    new Hono<Env>()
      .get('/status', async (c) => c.json(await getCaptureStatus()))
      .post('/retention/prune', async (c) => {
        return c.json(await pruneCaptureRetention())
      })
      .get('/consents', (c) => {
        return c.json({
          consents: listCaptureConsents(c.req.query('bucketId') || undefined),
        })
      })
      .put('/consents', async (c) => {
        const body = ConsentSchema.parse(await c.req.json())
        return c.json({
          consent: setCaptureConsent({
            domain: body.domain,
            class: body.class,
            bucketId: body.bucketId,
            allowed: body.allowed,
          }),
        })
      })
      .post('/meetings/start', async (c) => {
        const body = StartMeetingSchema.parse(await c.req.json())
        const session = await startMeetingCapture({
          tabId: body.tabId,
          bucketId: body.bucketId ?? DEFAULT_BUCKET_ID,
          url: body.url,
          title: body.title,
          provider: body.provider as TranscriptionProviderId | undefined,
          requireConsent: body.requireConsent,
          includeMic: body.includeMic,
          resumeSessionId: body.resumeSessionId,
        })
        return c.json({ session })
      })
      .post('/meetings/stop', async (c) => {
        const body = z
          .object({ sessionId: z.string().min(1) })
          .parse(await c.req.json())
        return c.json({ session: await stopMeetingCapture(body.sessionId) })
      })
      .post('/meetings/interrupt', async (c) => {
        const body = z
          .object({ sessionId: z.string().min(1) })
          .parse(await c.req.json())
        return c.json({
          session: await interruptMeetingCapture(body.sessionId),
        })
      })
      .post('/meetings/pause', async (c) => {
        const body = z
          .object({ sessionId: z.string().min(1) })
          .parse(await c.req.json())
        return c.json({ session: await pauseMeetingCapture(body.sessionId) })
      })
      .post('/meetings/resume', async (c) => {
        const body = z
          .object({ sessionId: z.string().min(1) })
          .parse(await c.req.json())
        return c.json({ session: await unpauseMeetingCapture(body.sessionId) })
      })
      .post('/meetings/fail', async (c) => {
        const body = z
          .object({
            sessionId: z.string().min(1),
            message: z.string().min(1),
          })
          .parse(await c.req.json())
        return c.json({
          session: await failMeetingCapture(body.sessionId, body.message),
        })
      })
      .delete('/meetings/:id', async (c) => {
        const id = c.req.param('id')
        await deleteMeetingCapture(id)
        return c.json({ ok: true })
      })
      .get('/meetings', (c) => {
        return c.json({
          sessions: listCaptureSessions({
            bucketId: c.req.query('bucketId') || undefined,
            kind: 'meeting',
          }),
        })
      })
      .get('/meetings/:id', (c) => {
        const session = getCaptureSession(c.req.param('id'))
        if (!session) return c.json({ error: 'Not found' }, 404)
        return c.json({ session })
      })
      .get('/meetings/:id/transcript', async (c) => {
        const session = getCaptureSession(c.req.param('id'))
        if (!session) return c.json({ error: 'Not found' }, 404)
        if (!session.transcriptPath) {
          return c.json({ sessionId: session.id, segments: [] })
        }
        try {
          const raw = await readFile(session.transcriptPath, 'utf8')
          const segments = raw
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line))
          return c.json({ sessionId: session.id, segments })
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return c.json({ sessionId: session.id, segments: [] })
          }
          return c.json({ error: 'Transcript unavailable' }, 500)
        }
      })
      .get('/meetings/:id/events', async (c) => {
        const sessionId = c.req.param('id')
        const session = getCaptureSession(sessionId)
        if (!session) return c.json({ error: 'Not found' }, 404)
        const lastEventId = Number(c.req.header('Last-Event-ID') ?? '0')

        return streamSSE(c, async (stream) => {
          // Replay transcript lines as segment events when reconnecting
          if (session.transcriptPath && lastEventId === 0) {
            try {
              const raw = await readFile(session.transcriptPath, 'utf8')
              let cursor = 0
              for (const line of raw.split('\n')) {
                if (!line.trim()) continue
                cursor++
                const segment = JSON.parse(line)
                await stream.writeSSE({
                  id: String(cursor),
                  event: segment.kind === 'gap' ? 'gap' : 'segment',
                  data: JSON.stringify(segment),
                })
              }
            } catch {
              /* empty */
            }
          }

          await stream.writeSSE({
            id: String(getCaptureEventCursor(sessionId)),
            event: 'status',
            data: JSON.stringify({
              sessionId,
              status: session.status,
            }),
          })

          let closed = false
          const unsub = subscribeCaptureEvents(sessionId, async (event) => {
            if (closed) return
            if (event.cursor <= lastEventId) return
            const eventName =
              event.type === 'segment'
                ? 'segment'
                : event.type === 'gap'
                  ? 'gap'
                  : event.type === 'heartbeat'
                    ? 'heartbeat'
                    : 'status'
            const data =
              event.type === 'segment' || event.type === 'gap'
                ? JSON.stringify(event.segment)
                : JSON.stringify(event)
            await stream.writeSSE({
              id: String(event.cursor),
              event: eventName,
              data,
            })
          })

          const heartbeat = setInterval(() => {
            void stream.writeSSE({
              event: 'heartbeat',
              data: JSON.stringify({ ts: Date.now() }),
            })
          }, 15_000)

          stream.onAbort(() => {
            closed = true
            clearInterval(heartbeat)
            unsub()
          })

          // Keep stream open until client disconnects
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (closed) {
                clearInterval(check)
                resolve()
              }
            }, 500)
          })
        })
      })
      .get('/asr/model-status', async (c) => {
        const modelName = c.req.query('model') || undefined
        return c.json(await getAsrModelStatus(modelName))
      })
      .get('/asr/ensure-model', async (c) => {
        const modelName = c.req.query('model') || undefined
        return new Response(
          new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder()
              const send = (obj: object) => {
                controller.enqueue(
                  enc.encode(`data: ${JSON.stringify(obj)}\n\n`),
                )
              }
              try {
                await ensureAsrModel((progress) => send(progress), modelName)
                send({ done: true, percent: 100 })
              } catch (err) {
                send({ error: describeAsrDownloadError(err) })
              } finally {
                controller.close()
              }
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          },
        )
      })
      .post('/asr/transcribe', async (c) => {
        // One-shot dictation: accepts webm/opus audio, splits into sequential
        // 24-second feeds to the ASR sidecar (matching its MAX_WINDOW_SAMPLES),
        // and streams the transcript back over SSE as each feed finishes.
        // Long recordings can take longer than any single fixed request
        // timeout would allow, so the client watches for stream inactivity
        // instead of racing a flat deadline against the whole upload.
        const formData = await c.req.formData()
        const file = formData.get('file')
        if (!(file instanceof File)) {
          return c.json(
            { error: 'Missing audio file in form field "file"' },
            400,
          )
        }

        const { unlink } = await import('node:fs/promises')
        const { tmpdir } = await import('node:os')
        const { join } = await import('node:path')
        const { randomUUID } = await import('node:crypto')

        const sessionId = `dictation:${randomUUID()}`
        const tmpPath = join(tmpdir(), `pane-dictation-${randomUUID()}.webm`)

        let buf: Buffer
        try {
          buf = Buffer.from(await file.arrayBuffer())
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json({ error: message }, 500)
        }

        return streamSSE(c, async (stream) => {
          let closed = false
          stream.onAbort(() => {
            closed = true
          })
          const writeEvent = async (event: string, data: unknown) => {
            if (closed) return
            await stream
              .writeSSE({ event, data: JSON.stringify(data) })
              .catch(() => {})
          }
          // Fires regardless of whether the sidecar is actually making
          // progress, so it can't distinguish "still transcribing" from
          // "wedged" — a fully stuck sidecar only surfaces via the client's
          // absolute ceiling, not the inactivity watchdog this feeds.
          const heartbeat = setInterval(() => {
            void writeEvent('heartbeat', { ts: Date.now() })
          }, 10_000)

          try {
            if (buf.length < 100) {
              await writeEvent('final', { text: '' })
              return
            }
            await writeFile(tmpPath, buf)

            const segments: string[] = []

            await registerAsrSession(sessionId, {
              onPartial: () => {},
              onFinal: (seg) => {
                const text = seg.text?.trim()
                if (!text) return
                segments.push(text)
                void writeEvent('segment', {
                  text,
                  cumulative: segments.join(' '),
                })
              },
            })

            // The sidecar processes max 24s per feed (MAX_WINDOW_SAMPLES).
            // For longer audio, send multiple sequential feeds of the same file.
            // Each feed advances the internal lastEndSample window by 24s.
            // Estimate duration from file size (~32kbps for webm/opus).
            const estimatedDurationSec = Math.max(5, (buf.length * 8) / 32000)
            const numFeeds = Math.ceil(estimatedDurationSec / 24)

            for (let seq = 0; seq < numFeeds; seq++) {
              if (closed) break
              // Resolves only once the sidecar acks this feed, and the
              // sidecar emits the final segment before acking — so by the
              // time this loop finishes, every segment has already been
              // collected and streamed above.
              await enqueueAsrJob({
                sessionId,
                sequence: seq,
                mimeType: file.type || 'audio/webm',
                capturedAt: Date.now(),
                audioPath: tmpPath,
                force: true,
              })
            }

            await writeEvent('final', { text: segments.join(' ') })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            await writeEvent('error', { error: message })
          } finally {
            clearInterval(heartbeat)
            await unregisterAsrSession(sessionId)
            unlink(tmpPath).catch(() => {})
          }
        })
      })
      // Live dictation: the client registers a session up front, then feeds
      // the growing recording periodically while the user is still talking
      // (getting live captions over /events) instead of uploading once after
      // they stop. See /asr/transcribe above for the one-shot equivalent,
      // still used by voice-mode's short VAD-segmented utterances and as the
      // dictation retry path.
      .post('/dictation/:sessionId/feed', async (c) => {
        const sessionId = c.req.param('sessionId')
        const formData = await c.req.formData()
        const file = formData.get('file')
        if (!(file instanceof File)) {
          return c.json(
            { error: 'Missing audio file in form field "file"' },
            400,
          )
        }
        const final = formData.get('final') === 'true'
        const force = formData.get('force') === 'true'

        const session = getOrCreateDictationSession(sessionId)
        touchDictationSession(session)

        try {
          const buf = Buffer.from(await file.arrayBuffer())
          await writeFile(session.tmpPath, buf)
          await ensureAsrRegistered(sessionId, session)
          await enqueueAsrJob({
            sessionId,
            sequence: nextSequence(session),
            mimeType: file.type || 'audio/webm',
            capturedAt: Date.now(),
            audioPath: session.tmpPath,
            force,
          })

          if (!final) return c.json({ ok: true })

          const text = getDictationSegments(session).at(-1)?.cumulative ?? ''
          await closeDictationSession(sessionId)
          return c.json({ ok: true, text })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (final) await closeDictationSession(sessionId).catch(() => {})
          return c.json({ error: message }, 500)
        }
      })
      .get('/dictation/:sessionId/events', async (c) => {
        const sessionId = c.req.param('sessionId')
        const session = getOrCreateDictationSession(sessionId)

        return streamSSE(c, async (stream) => {
          let closed = false

          // Subscribe before replaying the backlog (both synchronous, no
          // await between them) so a segment published while the replay
          // loop is still mid-flight — each writeSSE call below is an
          // await point — is caught by the live listener instead of being
          // silently dropped (publishCaptureEvent no-ops with no listener
          // registered yet).
          const unsub = subscribeCaptureEvents(sessionId, async (event) => {
            if (closed || event.type !== 'segment') return
            const text = event.segment.text?.trim()
            if (!text) return
            const cumulative =
              getDictationSegments(session).at(-1)?.cumulative ?? text
            await stream
              .writeSSE({
                event: 'segment',
                data: JSON.stringify({ text, cumulative }),
              })
              .catch(() => {})
          })

          // A snapshot copy, not a live reference — session.segments can
          // grow mid-loop (each writeSSE below is an await point) via the
          // listener just subscribed above, and iterating the live array
          // directly would then double-send whatever segment landed during
          // that window.
          const backlog = [...getDictationSegments(session)]
          for (const segment of backlog) {
            await stream
              .writeSSE({ event: 'segment', data: JSON.stringify(segment) })
              .catch(() => {})
          }

          const heartbeat = setInterval(() => {
            void stream
              .writeSSE({
                event: 'heartbeat',
                data: JSON.stringify({ ts: Date.now() }),
              })
              .catch(() => {})
          }, 10_000)

          // Disconnect only tears down this listener — an in-flight
          // recording must keep transcribing even if a backgrounded/
          // throttled tab drops the SSE connection. Cleanup is owned
          // exclusively by the final feed and the DELETE route below.
          stream.onAbort(() => {
            closed = true
            clearInterval(heartbeat)
            unsub()
          })

          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (closed) {
                clearInterval(check)
                resolve()
              }
            }, 500)
          })
        })
      })
      .delete('/dictation/:sessionId', async (c) => {
        const sessionId = c.req.param('sessionId')
        await closeDictationSession(sessionId)
        return c.json({ ok: true })
      })
      .post('/chunk', async (c) => {
        const body = ChunkSchema.parse(await c.req.json())
        try {
          await feedCaptureChunk({
            sessionId: body.sessionId,
            sequence: body.sequence,
            mimeType: body.mimeType,
            data: Buffer.from(body.dataBase64, 'base64'),
            capturedAt: body.capturedAt,
            track: body.track,
          })
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err)
          return c.json({ ok: false, error: message }, 500)
        }
        return c.json({ ok: true })
      })
      .post('/page-snapshot', async (c) => {
        const body = PageSnapshotSchema.parse(await c.req.json())
        await appendPageSnapshot(body)
        return c.json({ ok: true })
      })
      .post('/meetings/:id/speaker', async (c) => {
        const sessionId = c.req.param('id')
        const session = getCaptureSession(sessionId)
        if (!session) return c.json({ error: 'Not found' }, 404)
        if (
          session.status !== 'active' &&
          session.status !== 'interrupted' &&
          session.status !== 'paused'
        ) {
          return c.json({ error: 'Session not active' }, 409)
        }
        let body: z.infer<typeof SpeakerObservationSchema>
        try {
          body = SpeakerObservationSchema.parse(await c.req.json())
        } catch {
          return c.json({ error: 'Invalid body' }, 400)
        }
        if (body.participants) {
          setSessionParticipants(sessionId, body.participants)
          const capturedAt = body.observedAt
          await appendPageSnapshot({
            sessionId,
            title: 'participants',
            text: JSON.stringify(body.participants),
            capturedAt,
          }).catch(() => null)
        }
        recordSpeakerObservation(sessionId, {
          displayName: body.displayName,
          isLocalSelf: body.isLocalSelf,
          confidence: body.confidence,
          observedAt: body.observedAt,
          source: body.source,
          localSpeaking: body.localSpeaking,
        })
        return c.json({ ok: true })
      })
      .post('/browsing/observe', async (c) => {
        const body = BrowsingObservationSchema.parse(await c.req.json())
        return c.json(await observeBrowsingLearning(body))
      })
      .post('/research/page', async (c) => {
        const body = ResearchPageSchema.parse(await c.req.json())
        return c.json(recordResearchPage(body))
      })
  )
}

export type CaptureRoutes = ReturnType<typeof createCaptureRoutes>
