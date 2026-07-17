/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { isMeetingRoomUrl } from '@/lib/capture/meeting-urls'
import {
  useCaptureMeetings,
  useCaptureStatus,
  useCaptureTranscript,
} from './useCaptureApi'

function dedupeTranscriptFinals<T extends { kind: string; text: string }>(
  segments: T[],
): T[] {
  const finals = segments.filter((s) => s.kind === 'final')
  const deduped: T[] = []
  let lastText = ''
  for (const segment of finals) {
    const text = segment.text.trim()
    if (!text || text === lastText) continue
    if (lastText && text.startsWith(lastText)) continue
    deduped.push(segment)
    lastText = text
  }
  return deduped
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatDuration(startMs: number, endMs: number | null): string {
  const duration = (endMs ?? Date.now()) - startMs
  const minutes = Math.floor(duration / 60_000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export const CapturePage: FC = () => {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const status = useCaptureStatus()
  const meetings = useCaptureMeetings('default')
  const activeSelectedSession =
    meetings.sessions.find((s) => s.id === selectedSessionId) ?? null
  const transcript = useCaptureTranscript(
    selectedSessionId,
    activeSelectedSession?.status === 'active',
  )

  const visibleSessions = [...meetings.sessions]
    .filter((session) => !session.url || isMeetingRoomUrl(session.url))
    .sort((a, b) => b.startedAt - a.startedAt)

  useEffect(() => {
    if (selectedSessionId) return
    const latest = visibleSessions[0]
    if (latest) setSelectedSessionId(latest.id)
  }, [visibleSessions, selectedSessionId])

  useEffect(() => {
    if (!selectedSessionId) return
    if (visibleSessions.some((s) => s.id === selectedSessionId)) return
    setSelectedSessionId(visibleSessions[0]?.id ?? null)
  }, [visibleSessions, selectedSessionId])

  const selectedSession = visibleSessions.find(
    (s) => s.id === selectedSessionId,
  )
  const dedupedSegments = dedupeTranscriptFinals(transcript.segments)

  return (
    <div className="fade-in animate-in space-y-4 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-semibold text-lg tracking-tight">Meetings</h1>
          {status.data?.paused && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              Paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/settings/permissions"
            className="inline-flex h-7 items-center justify-center rounded-md border px-2 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted/80"
          >
            Settings
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => meetings.refetch()}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-[220px_1fr] gap-4">
        {/* Left: session list */}
        <div
          className="space-y-1.5 overflow-y-auto"
          style={{ maxHeight: 'calc(100vh - 180px)' }}
        >
          {meetings.loading && (
            <p className="px-2 py-6 text-center text-muted-foreground text-xs">
              Loading...
            </p>
          )}
          {!meetings.loading && meetings.error && (
            <p className="px-2 py-6 text-center text-muted-foreground text-xs">
              Can&apos;t reach the Pane server. Restart Pane and try Refresh.
            </p>
          )}
          {!meetings.loading &&
            !meetings.error &&
            visibleSessions.length === 0 && (
              <p className="px-2 py-6 text-center text-muted-foreground text-xs">
                No meetings yet. Join a Google Meet with capture enabled.
              </p>
            )}
          {visibleSessions.map((session) => {
            const isSelected = session.id === selectedSessionId
            const isActive = session.status === 'active'
            return (
              <button
                type="button"
                key={session.id}
                onClick={() => setSelectedSessionId(session.id)}
                className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                  isSelected
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isActive && (
                    <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                  )}
                  <span className="truncate font-medium text-xs">
                    {session.title ?? 'Meeting'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{formatRelativeTime(session.startedAt)}</span>
                  <span className="opacity-40">·</span>
                  <span>
                    {formatDuration(session.startedAt, session.endedAt)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Right: transcript */}
        <div
          className="overflow-y-auto rounded-xl border border-border/40 bg-card/50"
          style={{ maxHeight: 'calc(100vh - 180px)' }}
        >
          {!selectedSessionId && (
            <div className="flex h-full items-center justify-center p-8">
              <p className="text-muted-foreground text-xs">
                Select a meeting to view its transcript.
              </p>
            </div>
          )}

          {selectedSessionId && (
            <div className="flex flex-col">
              {/* Session header */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-border/30 border-b bg-card/80 px-4 py-2.5 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  {selectedSession?.status === 'active' && (
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
                  )}
                  <span className="font-medium text-xs">
                    {selectedSession?.title ?? 'Meeting'}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {selectedSession &&
                      formatDuration(
                        selectedSession.startedAt,
                        selectedSession.endedAt,
                      )}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => transcript.refetch()}
                >
                  Reload
                </Button>
              </div>

              {/* Transcript body */}
              <div className="space-y-0 divide-y divide-border/20 px-4">
                {transcript.loading && (
                  <p className="py-8 text-center text-muted-foreground text-xs">
                    Loading transcript...
                  </p>
                )}
                {!transcript.loading && transcript.error && (
                  <p className="py-8 text-center text-muted-foreground text-xs">
                    Can&apos;t load transcript. The Pane server may be down.
                    Restart Pane and hit Reload.
                  </p>
                )}
                {!transcript.loading &&
                  !transcript.error &&
                  dedupedSegments.length === 0 && (
                    <p className="py-8 text-center text-muted-foreground text-xs">
                      No transcript yet. Speak during the call to see text here.
                    </p>
                  )}
                {dedupedSegments.map((segment) => (
                  <div key={segment.id} className="py-2.5">
                    <span className="mr-2 font-mono text-[10px] text-muted-foreground/60">
                      {new Date(segment.capturedAt).toLocaleTimeString(
                        undefined,
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        },
                      )}
                    </span>
                    <span className="text-[13px] leading-relaxed">
                      {segment.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
