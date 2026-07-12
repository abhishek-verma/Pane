/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { isMeetingRoomUrl } from '@/lib/capture/meeting-urls'
import { researchModeStorage } from '@/lib/capture/research-mode'
import { useContextBuckets } from '@/screens/context/useContextApi'
import {
  type CaptureClass,
  useCaptureConsents,
  useCaptureMeetings,
  useCaptureStatus,
  useCaptureTranscript,
} from './useCaptureApi'

const CONSENT_CLASSES: CaptureClass[] = ['meeting', 'browsing', 'research']

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
  const [bucketId, setBucketId] = useState('default')
  const [domainInput, setDomainInput] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [showSettings, setShowSettings] = useState(false)
  const [researchMode, setResearchMode] = useState(false)
  const { buckets, loading: bucketsLoading } = useContextBuckets()
  const status = useCaptureStatus()
  const meetings = useCaptureMeetings(bucketId)
  const consents = useCaptureConsents(bucketId)
  const transcript = useCaptureTranscript(selectedSessionId)

  const visibleSessions = [...meetings.sessions]
    .filter((session) => !session.url || isMeetingRoomUrl(session.url))
    .sort((a, b) => b.startedAt - a.startedAt)

  useEffect(() => {
    void researchModeStorage.getValue().then(setResearchMode)
  }, [])

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

  const domains = Array.from(
    new Set(consents.consents.map((c) => c.domain)),
  ).sort()
  const visibleDomains = domains.length > 0 ? domains : ['meet.google.com']

  const reassignDomainBucket = (domain: string, nextBucketId: string) => {
    for (const captureClass of CONSENT_CLASSES) {
      const consent = consents.consents.find(
        (item) => item.domain === domain && item.class === captureClass,
      )
      if (!consent) continue
      consents.setConsent.mutate({
        domain,
        class: captureClass,
        allowed: consent.allowed,
        bucketId: nextBucketId,
      })
    }
  }

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
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowSettings(!showSettings)}
          >
            {showSettings ? 'Close' : 'Settings'}
          </Button>
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

      {/* Settings (collapsible) */}
      {showSettings && (
        <div className="space-y-4 rounded-xl border border-border/50 bg-muted/30 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={bucketId} onValueChange={setBucketId}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(buckets.length > 0
                  ? buckets
                  : [{ id: 'default', name: 'Default' }]
                ).map((bucket) => (
                  <SelectItem key={bucket.id} value={bucket.id}>
                    {bucket.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex cursor-pointer items-center gap-2 text-muted-foreground text-xs">
              <Switch
                checked={researchMode}
                onCheckedChange={(enabled) => {
                  setResearchMode(enabled)
                  void researchModeStorage.setValue(enabled)
                }}
              />
              Research mode
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Allowed domains
            </div>
            <div className="flex gap-2">
              <input
                className="h-8 w-56 rounded-lg border bg-background px-2.5 text-xs"
                placeholder="e.g. meet.google.com"
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !domainInput.trim()) return
                  void consents.setConsent.mutateAsync({
                    domain: domainInput.trim(),
                    class: 'meeting',
                    allowed: true,
                    bucketId,
                  })
                  setDomainInput('')
                }}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  if (!domainInput.trim()) return
                  void consents.setConsent.mutateAsync({
                    domain: domainInput.trim(),
                    class: 'meeting',
                    allowed: true,
                    bucketId,
                  })
                  setDomainInput('')
                }}
              >
                Add
              </Button>
            </div>
            {visibleDomains.map((domain) => (
              <div
                key={domain}
                className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2"
              >
                <span className="font-medium text-xs">{domain}</span>
                <div className="flex items-center gap-3">
                  {CONSENT_CLASSES.map((captureClass) => {
                    const consent = consents.consents.find(
                      (item) =>
                        item.domain === domain && item.class === captureClass,
                    )
                    return (
                      <div
                        key={captureClass}
                        className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <Switch
                          checked={consent?.allowed ?? false}
                          onCheckedChange={(allowed) =>
                            consents.setConsent.mutate({
                              domain,
                              class: captureClass,
                              allowed,
                              bucketId: consent?.bucketId ?? bucketId,
                            })
                          }
                        />
                        {captureClass}
                      </div>
                    )
                  })}
                  <Select
                    value={
                      consents.consents.find((item) => item.domain === domain)
                        ?.bucketId ?? bucketId
                    }
                    onValueChange={(nextBucketId) =>
                      reassignDomainBucket(domain, nextBucketId)
                    }
                  >
                    <SelectTrigger className="h-6 w-28 text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(buckets.length > 0
                        ? buckets
                        : [{ id: 'default', name: 'Default' }]
                      ).map((bucket) => (
                        <SelectItem key={bucket.id} value={bucket.id}>
                          {bucket.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session list + transcript split */}
      <div className="grid grid-cols-[220px_1fr] gap-4">
        {/* Left: session list */}
        <div
          className="space-y-1.5 overflow-y-auto"
          style={{ maxHeight: 'calc(100vh - 180px)' }}
        >
          {(meetings.loading || bucketsLoading) && (
            <p className="px-2 py-6 text-center text-muted-foreground text-xs">
              Loading...
            </p>
          )}
          {!meetings.loading && visibleSessions.length === 0 && (
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
                {!transcript.loading && dedupedSegments.length === 0 && (
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
