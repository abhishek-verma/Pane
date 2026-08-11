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
  buildMeetingSummaryMarkdown,
  CAPTURE_TRANSCRIPT_MAX_CHARS,
  formatCaptureListLine,
  formatCaptureWhen,
  loadFormattedTranscript,
  readTranscriptSegments,
  writeMeetingSummaryFile,
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

function isPendingSummaryStub(body: string): boolean {
  return body.includes('Summary is pending')
}

/** Prefer a real excerpt over the start-time "pending" stub when segments exist. */
async function resolveSummaryBody(
  session: NonNullable<ReturnType<typeof getCaptureSession>>,
  formatted: Awaited<ReturnType<typeof loadFormattedTranscript>>,
): Promise<string> {
  let body = await readSummaryFile(session.summaryPath)
  if (!isPendingSummaryStub(body) && body.trim()) return body
  if (formatted.segmentCount === 0 && !formatted.text) {
    return body.trim()
      ? body
      : `No summary yet for ${session.id}. Transcript segments: 0.`
  }
  await writeMeetingSummaryFile(
    session,
    formatted.text,
    formatted.segmentCount,
    formatted.truncated,
  ).catch(() => undefined)
  body = await readSummaryFile(session.summaryPath)
  if (body.trim() && !isPendingSummaryStub(body)) return body
  return await buildMeetingSummaryMarkdown({
    session,
    transcriptText: formatted.text,
    segmentCount: formatted.segmentCount,
    truncated: formatted.truncated,
  })
}

function formatTranscriptToolText(
  sessionId: string,
  status: string,
  formatted: Awaited<ReturnType<typeof loadFormattedTranscript>>,
  offset: number,
): { text: string } {
  if (!formatted.text) {
    if (offset > 0 && offset >= formatted.totalChars) {
      return {
        text: `No more transcript content for ${sessionId} — offset ${offset} is at or past the end (${formatted.totalChars} chars total).`,
      }
    }
    return {
      text: `No transcript text for ${sessionId} yet (status=${status}, segments=${formatted.segmentCount}).`,
    }
  }
  return {
    text: formatted.truncated
      ? `${formatted.text}\n\n(showed ${formatted.text.length} chars of ${formatted.totalChars} total; ${formatted.segmentCount} segments total. Call capture_read again with offset=${formatted.nextOffset} to continue reading.)`
      : formatted.text,
  }
}

function formatFullCaptureRead(input: {
  session: NonNullable<ReturnType<typeof getCaptureSession>>
  formatted: Awaited<ReturnType<typeof loadFormattedTranscript>>
  summaryBody: string
  offset: number
}): { text: string } {
  const { session, formatted, summaryBody, offset } = input
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
    ? `## Local excerpt / metadata\n\n${summaryBody.trim()}\n\n_(Not AI meeting notes — use the transcript below for content.)_\n\n`
    : '## Local excerpt / metadata\n\n_(none yet — transcript below)_\n\n'
  const transcriptNote = formatted.truncated
    ? `\n\n(showed ${formatted.text.length} chars of ${formatted.totalChars} total; call capture_read with include="transcript" and offset=${formatted.nextOffset} to continue reading.)`
    : ''
  const transcriptSection = formatted.text
    ? `## Transcript\n\n${formatted.text}${transcriptNote}`
    : offset > 0 && offset >= formatted.totalChars
      ? `## Transcript\n\n_(no more content — offset ${offset} is at or past the end, ${formatted.totalChars} chars total)_`
      : '## Transcript\n\n_(empty)_'
  return { text: `${header}${summarySection}${transcriptSection}` }
}

export function buildCaptureToolSet(
  getBucketId: () => string,
  options: { includeStartTool?: boolean } = {},
): ToolSet {
  const includeStartTool = options.includeStartTool ?? true
  const tools: ToolSet = {
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
        const allSessions = listCaptureSessions({
          bucketId: bucketId || getBucketId(),
        })
        if (allSessions.length === 0) return { text: 'No capture sessions.' }

        // Drop content-less error sessions when a better session exists for
        // the same room — these are failed-start duplicates, not real
        // recordings, and only confuse sessionId selection.
        const roomsWithContent = new Set(
          allSessions
            .filter((s) => s.status !== 'error' && s.roomKey)
            .map((s) => s.roomKey),
        )
        const sessions = allSessions.filter((s) => {
          if (s.status !== 'error') return true
          if (!s.roomKey) return true
          return !roomsWithContent.has(s.roomKey)
        })
        const hiddenCount = allSessions.length - sessions.length

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
        const hiddenNote =
          hiddenCount > 0
            ? `\n(hid ${hiddenCount} failed-start session(s) with no content, superseded by another session in the same room)`
            : ''
        return {
          text: `Local meeting captures (newest first). Use capture_read with a sessionId to get the transcript.\n${lines.join('\n')}${more}${hiddenNote}`,
        }
      },
    }),
    capture_read: tool({
      description:
        'Read a local meeting capture. Default include="full" returns metadata, a short local excerpt (not AI meeting notes), and transcript text. Prefer include="transcript" or "full" for spoken content — do not use filesystem tools on ~/.browseros/capture paths.',
      inputSchema: z.object({
        sessionId: z.string().min(1),
        include: z
          .enum(['meta', 'transcript', 'summary', 'full'])
          .optional()
          .describe(
            'meta = JSON metadata only; transcript = spoken text; summary = local excerpt/metadata file (not AI notes); full = metadata + excerpt + transcript (default).',
          ),
        maxChars: z
          .number()
          .int()
          .min(500)
          .max(CAPTURE_TRANSCRIPT_MAX_CHARS)
          .optional()
          .describe('Max transcript characters to return (default 15000).'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'Character offset into the transcript to start reading from (default 0). Use the nextOffset hint from a truncated response to page through long transcripts.',
          ),
      }),
      execute: async ({ sessionId, include, maxChars, offset }) => {
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
        const formatted = await loadFormattedTranscript(
          session,
          limit,
          offset ?? 0,
        )
        if (mode === 'transcript') {
          return formatTranscriptToolText(
            sessionId,
            session.status,
            formatted,
            offset ?? 0,
          )
        }

        const summaryBody = await resolveSummaryBody(session, formatted)
        if (mode === 'summary') {
          return {
            text:
              summaryBody.trim() ||
              `No summary file for ${sessionId}. Transcript segments: ${formatted.segmentCount}.`,
          }
        }

        return formatFullCaptureRead({
          session,
          formatted,
          summaryBody,
          offset: offset ?? 0,
        })
      },
    }),
  }

  if (includeStartTool) {
    tools.capture_start = tool({
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
    })
  }

  return tools
}
