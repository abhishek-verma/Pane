/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { PROMOTED_ARG } from '@browseros/shared/trust/consequence-class'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import {
  getCaptureSession,
  listCaptureSessions,
  startMeetingCapture,
  stopMeetingCapture,
} from './meeting-pipeline'
import { getCaptureStatus } from './performance'

const promotedField = {
  [PROMOTED_ARG]: z.boolean().optional(),
} as const

export function buildCaptureToolSet(getBucketId: () => string): ToolSet {
  return {
    capture_start: tool({
      description:
        'Start a consented local meeting capture for the current browser tab. Writes audio/transcripts under the selected bucket.',
      inputSchema: z.object({
        tabId: z.number().int(),
        url: z.string().url(),
        title: z.string().optional(),
        bucketId: z.string().optional(),
        provider: z
          .enum(['local-faster-whisper', 'openai-byok', 'deepgram-byok'])
          .optional(),
        ...promotedField,
      }),
      execute: async ({ tabId, url, title, bucketId, provider }) => {
        const session = await startMeetingCapture({
          tabId,
          url,
          title,
          bucketId: bucketId || getBucketId() || DEFAULT_BUCKET_ID,
          provider,
        })
        return {
          text: `Started capture ${session.id} in bucket ${session.bucketId}.`,
        }
      },
    }),
    capture_stop: tool({
      description: 'Stop a local meeting capture session and index it.',
      inputSchema: z.object({
        sessionId: z.string().min(1),
        ...promotedField,
      }),
      execute: async ({ sessionId }) => {
        const session = await stopMeetingCapture(sessionId)
        if (!session)
          return { text: `Capture not found: ${sessionId}`, isError: true }
        return { text: `Stopped capture ${session.id}.` }
      },
    }),
    capture_status: tool({
      description:
        'Read local capture status, pause reason, disk usage, and active session count.',
      inputSchema: z.object({}),
      execute: async () => ({ text: JSON.stringify(await getCaptureStatus()) }),
    }),
    capture_list: tool({
      description: 'List local capture sessions in the active bucket.',
      inputSchema: z.object({
        bucketId: z.string().optional(),
      }),
      execute: async ({ bucketId }) => {
        const sessions = listCaptureSessions({
          bucketId: bucketId || getBucketId(),
        })
        if (sessions.length === 0) return { text: 'No capture sessions.' }
        return {
          text: sessions
            .map(
              (s) =>
                `- [${s.status}] ${s.title ?? s.url ?? s.id} (${s.id}) bucket=${s.bucketId}`,
            )
            .join('\n'),
        }
      },
    }),
    capture_read: tool({
      description: 'Read metadata for one local capture session.',
      inputSchema: z.object({
        sessionId: z.string().min(1),
      }),
      execute: async ({ sessionId }) => {
        const session = getCaptureSession(sessionId)
        if (!session)
          return { text: `Capture not found: ${sessionId}`, isError: true }
        return { text: JSON.stringify(session) }
      },
    }),
  }
}
