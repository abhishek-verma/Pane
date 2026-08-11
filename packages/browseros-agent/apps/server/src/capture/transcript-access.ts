/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Helpers for reading local meeting transcripts into agent-facing text.
 * Capture tools should use this instead of filesystem_bash / filesystem_read.
 */

import { readFile, writeFile } from 'node:fs/promises'
import type { TranscriptSegment } from '@browseros/capture/types'
import { SUMMARY_MAX_CHARS } from '@browseros/context-graph/constants'
import { TOOL_LIMITS } from '@browseros/shared/constants/limits'
import type { CaptureSessionSummary } from './meeting-pipeline'

export const CAPTURE_TRANSCRIPT_MAX_CHARS: number =
  TOOL_LIMITS.FILESYSTEM_READ_MAX_CHARS

const PLACEHOLDER_GRAPH_SUMMARY_PREFIX = 'Meeting transcript stored at'

export async function readTranscriptSegments(
  transcriptPath: string | null | undefined,
): Promise<TranscriptSegment[]> {
  if (!transcriptPath) return []
  try {
    const raw = await readFile(transcriptPath, 'utf8')
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as TranscriptSegment]
        } catch {
          return []
        }
      })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

/** Join final (and gap) segment text for display / indexing. */
export function formatTranscriptPlainText(
  segments: TranscriptSegment[],
  maxChars = CAPTURE_TRANSCRIPT_MAX_CHARS,
  offset = 0,
): {
  text: string
  segmentCount: number
  truncated: boolean
  totalChars: number
  nextOffset: number | null
} {
  const lines: string[] = []
  for (const segment of segments) {
    if (segment.kind === 'partial') continue
    const body = (segment.text ?? '').trim()
    if (!body && segment.kind !== 'gap') continue
    const speaker = segment.speaker?.trim()
    const prefix =
      segment.kind === 'gap' ? '[gap]' : speaker ? `[${speaker}] ` : ''
    lines.push(`${prefix}${body || segment.reason || ''}`.trimEnd())
  }
  const joined = lines.join('\n').trim()
  const segmentCount = segments.filter((s) => s.kind !== 'partial').length
  const totalChars = joined.length
  const start = Math.min(Math.max(0, offset), totalChars)
  const window = joined.slice(start, start + maxChars)
  const truncated = start + window.length < totalChars
  return {
    text: truncated ? `${window}\n\n…(truncated)` : window,
    segmentCount,
    truncated,
    totalChars,
    nextOffset: truncated ? start + window.length : null,
  }
}

export function formatCaptureDurationMs(
  startedAt: number,
  endedAt: number | null,
): string {
  const end = endedAt ?? Date.now()
  const ms = Math.max(0, end - startedAt)
  const totalSec = Math.round(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (hours > 0) return `${hours}h${String(mins).padStart(2, '0')}m`
  if (mins > 0) return `${mins}m${String(secs).padStart(2, '0')}s`
  return `${secs}s`
}

export function formatCaptureWhen(ms: number): string {
  try {
    return new Date(ms)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, 'Z')
  } catch {
    return String(ms)
  }
}

export function buildMeetingGraphSummary(input: {
  session: CaptureSessionSummary
  transcriptText: string
  segmentCount: number
}): string {
  const { session, transcriptText, segmentCount } = input
  const where = [session.site, session.roomKey || session.title]
    .filter(Boolean)
    .join('/')
  const when = formatCaptureWhen(session.startedAt)
  const header = [
    `Meeting${where ? ` (${where})` : ''}`,
    when,
    session.url ? session.url : null,
    `${segmentCount} transcript segments`,
  ]
    .filter(Boolean)
    .join(' · ')

  if (!transcriptText) {
    return truncateSummary(
      `${header}. No transcript text yet (empty or still processing).`,
    )
  }
  return truncateSummary(`${header}\n\n${transcriptText}`)
}

function truncateSummary(text: string): string {
  if (text.length <= SUMMARY_MAX_CHARS) return text
  return `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…`
}

export function isPlaceholderMeetingGraphSummary(
  summary: string | null | undefined,
): boolean {
  return Boolean(summary?.startsWith(PLACEHOLDER_GRAPH_SUMMARY_PREFIX))
}

/** Short excerpt for summary.md — full text comes from capture_read transcript. */
const SUMMARY_EXCERPT_CHARS = 600

export async function buildMeetingSummaryMarkdown(input: {
  session: CaptureSessionSummary
  transcriptText: string
  segmentCount: number
  truncated: boolean
}): Promise<string> {
  const { session, transcriptText, segmentCount, truncated } = input
  const duration = formatCaptureDurationMs(session.startedAt, session.endedAt)
  const excerpt =
    transcriptText.length > SUMMARY_EXCERPT_CHARS
      ? `${transcriptText.slice(0, SUMMARY_EXCERPT_CHARS)}\n\n…(excerpt; use capture_read include=transcript for full text)`
      : transcriptText
  const lines = [
    `# ${session.title ?? 'Meeting capture'}`,
    '',
    `- Status: ${session.status}`,
    `- URL: ${session.url ?? '(none)'}`,
    `- Site/room: ${session.site ?? 'unknown'} / ${session.roomKey ?? '(none)'}`,
    `- Started: ${formatCaptureWhen(session.startedAt)}`,
    `- Ended: ${session.endedAt ? formatCaptureWhen(session.endedAt) : '(active)'}`,
    `- Duration: ${duration}`,
    `- Transcript segments: ${segmentCount}${truncated ? ' (source truncated)' : ''}`,
    '',
    '## Excerpt',
    '',
    excerpt || '_No transcript text yet._',
    '',
  ]
  return lines.join('\n')
}

export async function writeMeetingSummaryFile(
  session: CaptureSessionSummary,
  transcriptText: string,
  segmentCount: number,
  truncated: boolean,
): Promise<void> {
  if (!session.summaryPath) return
  const body = await buildMeetingSummaryMarkdown({
    session,
    transcriptText,
    segmentCount,
    truncated,
  })
  await writeFile(session.summaryPath, body)
}

export async function loadFormattedTranscript(
  session: CaptureSessionSummary,
  maxChars = CAPTURE_TRANSCRIPT_MAX_CHARS,
  offset = 0,
): Promise<{
  segments: TranscriptSegment[]
  text: string
  segmentCount: number
  truncated: boolean
  totalChars: number
  nextOffset: number | null
}> {
  const segments = await readTranscriptSegments(session.transcriptPath)
  const formatted = formatTranscriptPlainText(segments, maxChars, offset)
  return { segments, ...formatted }
}

export function formatCaptureListLine(
  session: CaptureSessionSummary,
  extras?: { segmentCount?: number; hasTranscript?: boolean },
): string {
  const when = formatCaptureWhen(session.startedAt)
  const duration = formatCaptureDurationMs(session.startedAt, session.endedAt)
  const label = session.roomKey || session.title || session.url || session.id
  const site = session.site ?? 'unknown'
  const seg =
    extras?.segmentCount != null
      ? ` segments=${extras.segmentCount}`
      : extras?.hasTranscript === false
        ? ' segments=0'
        : ''
  return `- [${session.status}] ${when} · ${duration} · ${site}/${label} (${session.id}) bucket=${session.bucketId}${seg}`
}
