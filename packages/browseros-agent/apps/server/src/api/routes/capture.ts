/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile } from 'node:fs/promises'
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
  drainAsrSession,
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
  track: z.enum(['mixed', 'mic']).optional(),
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

export function createCaptureRoutes() {
  return new Hono<Env>()
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
      return c.json({ session: await interruptMeetingCapture(body.sessionId) })
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
              controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
            }
            try {
              await ensureAsrModel((progress) => send(progress), modelName)
              send({ done: true, percent: 100 })
            } catch (err) {
              send({ error: String(err) })
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
      // One-shot dictation: accepts a multipart audio blob (webm/opus from
      // MediaRecorder), feeds it to the shared Whisper sidecar as a single
      // large chunk, and returns the full transcript once done.
      const formData = await c.req.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return c.json({ error: 'Missing audio file in form field "file"' }, 400)
      }

      const { writeFile, unlink } = await import('node:fs/promises')
      const { tmpdir } = await import('node:os')
      const { join } = await import('node:path')
      const { randomUUID } = await import('node:crypto')

      const sessionId = `dictation:${randomUUID()}`
      const tmpPath = join(tmpdir(), `pane-dictation-${randomUUID()}.webm`)

      try {
        const buf = Buffer.from(await file.arrayBuffer())
        await writeFile(tmpPath, buf)

        const segments: string[] = []
        let lastSegmentAt = 0

        await registerAsrSession(sessionId, {
          onPartial: () => {},
          onFinal: (seg) => {
            if (seg.text?.trim()) segments.push(seg.text.trim())
            lastSegmentAt = Date.now()
          },
        })

        await enqueueAsrJob({
          sessionId,
          sequence: 0,
          mimeType: file.type || 'audio/webm',
          capturedAt: Date.now(),
          audioPath: tmpPath,
          force: true,
        })

        // drainAsrSession resolves when the job is acked (sent to sidecar),
        // but transcript segments arrive AFTER the ack. Wait for segments to
        // stop arriving — the sidecar processes audio in internal chunks and
        // emits segments with gaps of up to 10s between them for large files.
        await drainAsrSession(sessionId)

        // Minimum wait: proportional to file size (~1s processing per 100KB).
        // This prevents premature return for large files where the first segment
        // arrives quickly but subsequent ones take time.
        const minWaitMs = Math.min(30_000, Math.max(5000, buf.length / 100))
        const startedAt = Date.now()
        const deadline = startedAt + 60_000

        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 500))
          const elapsed = Date.now() - startedAt
          const sinceLastSeg =
            lastSegmentAt > 0 ? Date.now() - lastSegmentAt : 0
          // Only return when:
          // 1. We've waited at least the minimum time (proportional to file size)
          // 2. AND no new segments for 5 seconds (sidecar is done)
          if (
            elapsed >= minWaitMs &&
            sinceLastSeg > 5000 &&
            segments.length > 0
          )
            break
          // Safety: if we've received segments and nothing for 10s, assume done
          if (segments.length > 0 && sinceLastSeg > 10_000) break
        }

        return c.json({ text: segments.join(' ') })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return c.json({ error: message }, 500)
      } finally {
        await unregisterAsrSession(sessionId)
        unlink(tmpPath).catch(() => {})
      }
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
}

export type CaptureRoutes = ReturnType<typeof createCaptureRoutes>
