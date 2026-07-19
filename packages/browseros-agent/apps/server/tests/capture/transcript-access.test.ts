/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import type { CaptureSessionSummary } from '../../src/capture/meeting-pipeline'
import {
  buildMeetingGraphSummary,
  formatCaptureListLine,
  formatTranscriptPlainText,
  isPlaceholderMeetingGraphSummary,
} from '../../src/capture/transcript-access'

function fakeSession(
  overrides: Partial<CaptureSessionSummary> = {},
): CaptureSessionSummary {
  return {
    id: 'sess-1',
    bucketId: 'default',
    kind: 'meeting',
    tabId: 1,
    url: 'https://meet.google.com/abc-defg-hij',
    title: 'Standup',
    status: 'stopped',
    provider: 'local-faster-whisper',
    startedAt: Date.parse('2026-07-19T04:00:00.000Z'),
    endedAt: Date.parse('2026-07-19T04:05:00.000Z'),
    transcriptPath: '/tmp/t.jsonl',
    summaryPath: '/tmp/s.md',
    graphNodeId: 'meeting:sess-1',
    site: 'meet',
    roomKey: 'abc-defg-hij',
    lastChunkAt: null,
    asrWatermarkPcm: 0,
    lastAsrSequence: -1,
    includeMic: false,
    ...overrides,
  }
}

describe('transcript-access', () => {
  it('formats final segments and skips partials', () => {
    const { text, segmentCount, truncated } = formatTranscriptPlainText(
      [
        {
          id: '1',
          sessionId: 's',
          kind: 'partial',
          text: 'ignore me',
          capturedAt: 1,
        },
        {
          id: '2',
          sessionId: 's',
          kind: 'final',
          text: 'Hello world',
          speaker: 'Abhishek',
          capturedAt: 2,
        },
        {
          id: '3',
          sessionId: 's',
          kind: 'final',
          text: 'Next line',
          capturedAt: 3,
        },
      ],
      15_000,
    )
    expect(text).toContain('[Abhishek] Hello world')
    expect(text).toContain('Next line')
    expect(text).not.toContain('ignore me')
    expect(segmentCount).toBe(2)
    expect(truncated).toBe(false)
  })

  it('builds searchable graph summaries from transcript text', () => {
    const summary = buildMeetingGraphSummary({
      session: fakeSession(),
      transcriptText: 'We decided to ship the capture tools today.',
      segmentCount: 3,
    })
    expect(summary).toContain('meet/abc-defg-hij')
    expect(summary).toContain('ship the capture tools')
    expect(isPlaceholderMeetingGraphSummary(summary)).toBe(false)
    expect(
      isPlaceholderMeetingGraphSummary(
        'Meeting transcript stored at /tmp/x.jsonl',
      ),
    ).toBe(true)
  })

  it('formats capture list lines with time and duration', () => {
    const line = formatCaptureListLine(fakeSession(), { segmentCount: 12 })
    expect(line).toContain('[stopped]')
    expect(line).toContain('5m00s')
    expect(line).toContain('meet/abc-defg-hij')
    expect(line).toContain('segments=12')
  })
})
