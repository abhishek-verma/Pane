/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile } from 'node:fs/promises'
import type { TranscriptionProviderId } from '@browseros/capture/types'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  observeBrowsingLearning,
  recordResearchPage,
} from '../../capture/browsing-observer'
import { listCaptureConsents, setCaptureConsent } from '../../capture/consent'
import {
  appendPageSnapshot,
  failMeetingCapture,
  feedCaptureChunk,
  getCaptureSession,
  listCaptureSessions,
  startMeetingCapture,
  stopMeetingCapture,
} from '../../capture/meeting-pipeline'
import {
  getCaptureStatus,
  pruneCaptureRetention,
} from '../../capture/performance'
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
})

const ChunkSchema = z.object({
  sessionId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
  capturedAt: z.number().optional(),
})

const PageSnapshotSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().optional(),
  url: z.string().optional(),
  text: z.string(),
  capturedAt: z.number().optional(),
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
      })
      return c.json({ session })
    })
    .post('/meetings/stop', async (c) => {
      const body = z
        .object({ sessionId: z.string().min(1) })
        .parse(await c.req.json())
      return c.json({ session: await stopMeetingCapture(body.sessionId) })
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
    .post('/chunk', async (c) => {
      const body = ChunkSchema.parse(await c.req.json())
      await feedCaptureChunk({
        sessionId: body.sessionId,
        sequence: body.sequence,
        mimeType: body.mimeType,
        data: Buffer.from(body.dataBase64, 'base64'),
        capturedAt: body.capturedAt,
      })
      return c.json({ ok: true })
    })
    .post('/page-snapshot', async (c) => {
      const body = PageSnapshotSchema.parse(await c.req.json())
      await appendPageSnapshot(body)
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
