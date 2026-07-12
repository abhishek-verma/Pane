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

export const CapturePage: FC = () => {
  const [bucketId, setBucketId] = useState('default')
  const [domainInput, setDomainInput] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null,
  )
  const [researchMode, setResearchMode] = useState(false)
  const { buckets, loading: bucketsLoading } = useContextBuckets()
  const status = useCaptureStatus()
  const meetings = useCaptureMeetings(bucketId)
  const consents = useCaptureConsents(bucketId)
  const transcript = useCaptureTranscript(selectedSessionId)

  useEffect(() => {
    void researchModeStorage.getValue().then(setResearchMode)
  }, [])

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
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Capture</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Meeting transcripts, browsing learnings, and research threads stay
            local and bucket-scoped.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => meetings.refetch()}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">Bucket</span>
        <Select value={bucketId} onValueChange={setBucketId}>
          <SelectTrigger className="w-56">
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
        <div className="flex items-center gap-2 text-sm">
          <Switch
            checked={researchMode}
            onCheckedChange={(enabled) => {
              setResearchMode(enabled)
              void researchModeStorage.setValue(enabled)
            }}
          />
          Researching
        </div>
        {status.data?.paused && (
          <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-700 text-xs dark:text-amber-300">
            Capture paused ({status.data.reason ?? 'resource budget'})
          </span>
        )}
      </div>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">Meetings</h2>
        {(meetings.loading || bucketsLoading) && (
          <p className="mt-3 text-muted-foreground text-sm">
            Loading meetings...
          </p>
        )}
        {meetings.error && (
          <p className="mt-3 text-destructive text-sm">
            {meetings.error instanceof Error
              ? meetings.error.message
              : 'Failed to load meetings'}
          </p>
        )}
        {!meetings.loading &&
          meetings.sessions.filter(
            (session) => !session.url || isMeetingRoomUrl(session.url),
          ).length === 0 && (
            <p className="mt-3 text-muted-foreground text-sm">
              No captured meetings in this bucket yet.
            </p>
          )}
        <ul className="mt-3 space-y-2">
          {meetings.sessions
            .filter((session) => !session.url || isMeetingRoomUrl(session.url))
            .map((session) => (
              <li
                key={session.id}
                className="rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="text-left"
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <div className="font-medium">
                      {session.title ?? session.url ?? session.id}
                    </div>
                    {session.url && (
                      <div className="truncate text-muted-foreground text-xs">
                        {session.url}
                      </div>
                    )}
                  </button>
                  <span
                    className={`rounded px-2 py-1 text-xs ${
                      session.status === 'error'
                        ? 'bg-destructive/15 text-destructive'
                        : session.status === 'active'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-muted'
                    }`}
                  >
                    {session.status}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-muted-foreground text-xs">
                  <span>Bucket: {session.bucketId}</span>
                  <span>Transcript: {session.transcriptPath ?? 'pending'}</span>
                </div>
              </li>
            ))}
        </ul>
      </section>

      {selectedSessionId && (
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-sm">Transcript</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => transcript.refetch()}
            >
              Reload
            </Button>
          </div>
          {transcript.loading && (
            <p className="mt-3 text-muted-foreground text-sm">
              Loading transcript...
            </p>
          )}
          {transcript.error && (
            <p className="mt-3 text-destructive text-sm">
              {transcript.error instanceof Error
                ? transcript.error.message
                : 'Failed to load transcript'}
            </p>
          )}
          {!transcript.loading && transcript.segments.length === 0 && (
            <p className="mt-3 text-muted-foreground text-sm">
              No transcript segments yet.
            </p>
          )}
          <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto text-sm">
            {transcript.segments
              .filter((segment) => segment.kind === 'final')
              .map((segment) => (
                <li key={segment.id} className="rounded-md border px-3 py-2">
                  <div className="text-muted-foreground text-xs">
                    {new Date(segment.capturedAt).toLocaleString()}
                  </div>
                  <div className="mt-1">{segment.text}</div>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">Capture Consent</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Capture is off by default. Enable each domain and class separately.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
            placeholder="domain, e.g. meet.google.com"
            value={domainInput}
            onChange={(event) => setDomainInput(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!domainInput.trim()) return
              void consents.setConsent.mutateAsync({
                domain: domainInput.trim(),
                class: 'meeting',
                allowed: false,
                bucketId,
              })
              setDomainInput('')
            }}
          >
            Add Domain
          </Button>
        </div>
        <div className="mt-4 space-y-3">
          {visibleDomains.map((domain) => (
            <div key={domain} className="rounded-md border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium text-sm">{domain}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Bucket</span>
                  <Select
                    value={
                      consents.consents.find((item) => item.domain === domain)
                        ?.bucketId ?? bucketId
                    }
                    onValueChange={(nextBucketId) =>
                      reassignDomainBucket(domain, nextBucketId)
                    }
                  >
                    <SelectTrigger className="h-8 w-40">
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
              <div className="mt-2 flex flex-wrap gap-4">
                {CONSENT_CLASSES.map((captureClass) => {
                  const consent = consents.consents.find(
                    (item) =>
                      item.domain === domain && item.class === captureClass,
                  )
                  return (
                    <div
                      key={captureClass}
                      className="flex items-center gap-2 text-sm"
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
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
