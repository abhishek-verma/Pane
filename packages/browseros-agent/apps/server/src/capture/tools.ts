/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile } from 'node:fs/promises'
import { PROMOTED_ARG } from '@browseros/shared/trust/consequence-class'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import {
  getCaptureSession,
  listCaptureSessions,
  stopMeetingCapture,
} from './meeting-pipeline'
import { getCaptureStatus } from './performance'
import {
  CAPTURE_TRANSCRIPT_MAX_CHARS,
  formatCaptureListLine,
  formatCaptureWhen,
  loadFormattedTranscript,
  readTranscriptSegments,
} from './transcript-access'

const promotedField = {
  [PROMOTED_ARG]: z.boolean().optional(),
} as const

async function segmentCountForSession(
  transcriptPath: string | null,
): Promise<number> {
  const segments = await readTranscriptSegments(transcriptPath)
  return segments.filter((s) => s.kind !== 'partial').length
}

async function readSummaryFile(summaryPath: string | null): Promise<string> {
  if (!summaryPath) return ''
  try {
    return await readFile(summaryPath, 'utf8')
  } catch {
    return ''
  }
}

function formatTranscriptToolText(
  sessionId: string,
  status: string,
  formatted: Awaited<ReturnType<typeof loadFormattedTranscript>>,
  maxChars: number,
): { text: string } {
  if (!formatted.text) {
    return {
      text: `No transcript text for ${sessionId} yet (status=${status}, segments=${formatted.segmentCount}).`,
    }
  }
  return {
    text: formatted.truncated
      ? `${formatted.text}\n\n(truncated at ${maxChars} chars; ${formatted.segmentCount} segments total)`
      : formatted.text,
  }
}

function formatFullCaptureRead(input: {
  session: NonNullable<ReturnType<typeof getCaptureSession>>
  formatted: Awaited<ReturnType<typeof loadFormattedTranscript>>
  summaryBody: string
}): { text: string } {
  const { session, formatted, summaryBody } = input
  const header = [
    `# Meeting capture ${session.id}`,
    `status: ${session.status}`,
    `title: ${session.title ?? '(none)'}`,
    `url: ${session.url ?? '(none)'}`,
    `site/room: ${session.site ?? 'unknown'} / ${session.roomKey ?? '(none)'}`,
    `started: ${formatCaptureWhen(session.startedAt)}`,
    `ended: ${session.endedAt ? formatCaptureWhen(session.endedAt) : '(active)'}`,
    `provider: ${session.provider}`,
    `segments: ${formatted.segmentCount}${formatted.truncated ? ' (transcript truncated below)' : ''}`,
    '',
  ].join('\n')
  const summarySection = summaryBody.trim()
    ? `## Summary\n\n${summaryBody.trim()}\n\n`
    : '## Summary\n\n_(none yet — transcript below)_\n\n'
  const transcriptSection = formatted.text
    ? `## Transcript\n\n${formatted.text}`
    : '## Transcript\n\n_(empty)_'
  return { text: `${header}${summarySection}${transcriptSection}` }
}

export function buildCaptureToolSet(getBucketId: () => string): ToolSet {
  return {
    capture_start: tool({
      description:
        'Meeting capture is started by the browser extension when the user joins a consented Meet/Zoom/Teams call. This tool does not start tab audio — use capture_status / capture_list to inspect sessions instead.',
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
      execute: async () => ({
        text: 'Meeting capture must be started by the browser extension (join a consented meeting). Creating a server-only session would leave an empty zombie with no audio.',
        isError: true,
      }),
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
      description:
        'List local meeting capture sessions (Pane-recorded Meet/Zoom/Teams/etc.). Prefer this over context_search or filesystem tools when the user asks about meetings, calls, or transcripts. Returns status, time, duration, site/room, id, and segment counts.',
      inputSchema: z.object({
        bucketId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      execute: async ({ bucketId, limit }) => {
        const sessions = listCaptureSessions({
          bucketId: bucketId || getBucketId(),
        })
        if (sessions.length === 0) return { text: 'No capture sessions.' }
        const capped = sessions.slice(0, limit ?? 20)
        const lines = await Promise.all(
          capped.map(async (s) =>
            formatCaptureListLine(s, {
              segmentCount: await segmentCountForSession(s.transcriptPath),
            }),
          ),
        )
        const more =
          sessions.length > capped.length
            ? `\n…and ${sessions.length - capped.length} older session(s). Pass a higher limit or filter by reading a specific sessionId.`
            : ''
        return {
          text: `Local meeting captures (newest first). Use capture_read with a sessionId to get the transcript.\n${lines.join('\n')}${more}`,
        }
      },
    }),
    capture_read: tool({
      description:
        'Read a local meeting capture. Default include="full" returns metadata plus summary and transcript text. Use this for meeting notes/transcripts — do not use filesystem_read or filesystem_bash on ~/.browseros/capture paths.',
      inputSchema: z.object({
        sessionId: z.string().min(1),
        include: z
          .enum(['meta', 'transcript', 'summary', 'full'])
          .optional()
          .describe(
            'meta = JSON metadata only; transcript = spoken text; summary = summary.md; full = metadata + summary + transcript (default).',
          ),
        maxChars: z
          .number()
          .int()
          .min(500)
          .max(CAPTURE_TRANSCRIPT_MAX_CHARS)
          .optional()
          .describe('Max transcript characters to return (default 15000).'),
      }),
      execute: async ({ sessionId, include, maxChars }) => {
        const session = getCaptureSession(sessionId)
        if (!session)
          return { text: `Capture not found: ${sessionId}`, isError: true }
        if (session.bucketId !== getBucketId()) {
          return {
            text: `Capture ${sessionId} is in bucket "${session.bucketId}", not the active bucket "${getBucketId()}".`,
            isError: true,
          }
        }

        const mode = include ?? 'full'
        if (mode === 'meta') {
          return { text: JSON.stringify(session, null, 2) }
        }

        const limit = maxChars ?? CAPTURE_TRANSCRIPT_MAX_CHARS
        const formatted = await loadFormattedTranscript(session, limit)
        if (mode === 'transcript') {
          return formatTranscriptToolText(
            sessionId,
            session.status,
            formatted,
            limit,
          )
        }

        const summaryBody = await readSummaryFile(session.summaryPath)
        if (mode === 'summary') {
          return {
            text:
              summaryBody.trim() ||
              `No summary file for ${sessionId}. Transcript segments: ${formatted.segmentCount}.`,
          }
        }

        return formatFullCaptureRead({ session, formatted, summaryBody })
      },
    }),
  }
}
