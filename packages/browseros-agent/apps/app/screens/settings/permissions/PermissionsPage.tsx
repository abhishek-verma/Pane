/**
 * Combined Privacy & Permissions Settings Page.
 * Manages domain-level indexing grants, battery-pause setting, global passive capture, and meeting transcription consents.
 */

import { type FC, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { browsingCaptureModeStorage } from '@/lib/capture/browsing-capture-mode'
import { researchModeStorage } from '@/lib/capture/research-mode'
import { useCaptureConsents } from '@/screens/capture/useCaptureApi'
import {
  useContextBuckets,
  useContextGrants,
  useContextSettings,
} from '@/screens/context/useContextApi'

export const PermissionsPage: FC = () => {
  const [bucketId, setBucketId] = useState('default')
  const [denyInput, setDenyInput] = useState('')
  const [meetingInput, setMeetingInput] = useState('')
  const [browsingOn, setBrowsingOn] = useState(false)
  const [researchOn, setResearchOn] = useState(false)

  const { buckets } = useContextBuckets()
  const {
    grants,
    setGrant,
    loading: grantsLoading,
  } = useContextGrants(bucketId, { deniedOnly: true })

  const { settings, updateSettings } = useContextSettings()
  const consents = useCaptureConsents(bucketId)

  // Load WXT storage values for global toggles
  useEffect(() => {
    void browsingCaptureModeStorage
      .getValue()
      .then((val) => setBrowsingOn(Boolean(val)))
    void researchModeStorage
      .getValue()
      .then((val) => setResearchOn(Boolean(val)))
  }, [])

  // Only display denied grants
  const deniedDomains = grants.filter((g) => !g.allowed)

  // Only display 'meeting' class domains
  const meetingConsents = consents.consents.filter((c) => c.class === 'meeting')
  const meetingDomains = Array.from(
    new Set(meetingConsents.map((c) => c.domain)),
  ).sort()

  const handleAddDenyDomain = () => {
    const domain = denyInput.trim()
    if (!domain) return
    setGrant.mutate({ domain, allowed: false })
    setDenyInput('')
  }

  const handleRemoveDenyDomain = (domain: string) => {
    setGrant.mutate({ domain, allowed: true })
  }

  const handleAddMeetingDomain = () => {
    const domain = meetingInput.trim()
    if (!domain) return
    void consents.setConsent.mutateAsync({
      domain,
      class: 'meeting',
      allowed: true,
      bucketId,
    })
    setMeetingInput('')
  }

  const handleToggleBrowsing = (checked: boolean) => {
    setBrowsingOn(checked)
    void browsingCaptureModeStorage.setValue(checked)
  }

  const handleToggleResearch = (checked: boolean) => {
    setResearchOn(checked)
    void researchModeStorage.setValue(checked)
  }

  const reassignDomainBucket = (domain: string, nextBucketId: string) => {
    const consent = consents.consents.find(
      (item) => item.domain === domain && item.class === 'meeting',
    )
    consents.setConsent.mutate({
      domain,
      class: 'meeting',
      allowed: consent?.allowed ?? true,
      bucketId: nextBucketId,
    })
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-8 duration-500">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Privacy & Permissions
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Manage what local data Pane is allowed to index or capture from your
            device.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-center">
          <span className="font-medium text-muted-foreground text-sm">
            Context Bucket
          </span>
          <Select value={bucketId} onValueChange={setBucketId}>
            <SelectTrigger className="h-9 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(buckets.length > 0
                ? buckets
                : [{ id: 'default', name: 'Default' }]
              ).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Section 1: Context Indexing (Denylist Only) */}
      <section className="space-y-4 rounded-xl border border-border/50 bg-card p-5">
        <div>
          <h2 className="font-medium text-base text-card-foreground">
            Context Indexing
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            All sites visited by the Pane agent are indexed by default. Add
            domains below to exclude them from indexing and all passive capture.
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            className="h-9 w-64 text-xs"
            placeholder="e.g. facebook.com"
            value={denyInput}
            onChange={(e) => setDenyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddDenyDomain()
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-4 text-xs"
            onClick={handleAddDenyDomain}
          >
            Exclude Domain
          </Button>
        </div>

        {grantsLoading && (
          <p className="text-muted-foreground text-sm">Loading exclusions…</p>
        )}

        {!grantsLoading && deniedDomains.length === 0 && (
          <p className="text-muted-foreground text-xs italic">
            No domains excluded. All sites are indexed.
          </p>
        )}

        {deniedDomains.length > 0 && (
          <ul className="max-h-60 divide-y divide-border/30 overflow-y-auto rounded-lg border border-border/40 bg-muted/10">
            {deniedDomains.map((grant) => (
              <li
                key={grant.domain}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span className="max-w-sm truncate font-medium text-xs">
                  {grant.domain}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2.5 text-destructive text-xs hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleRemoveDenyDomain(grant.domain)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Battery setting */}
        <div className="mt-2 flex items-center justify-between border-border/30 border-t pt-4">
          <div className="space-y-0.5">
            <label
              className="cursor-pointer font-medium text-card-foreground text-xs"
              htmlFor="battery-switch"
            >
              Pause indexing when on battery
            </label>
            <p className="text-[10px] text-muted-foreground">
              Saves energy and CPU by pausing background crawl when unplugged
              (recommended).
            </p>
          </div>
          <Switch
            id="battery-switch"
            checked={settings?.pauseOnBattery ?? true}
            onCheckedChange={(checked) =>
              updateSettings.mutate({ pauseOnBattery: checked })
            }
          />
        </div>
      </section>

      {/* Section 2: Passive Capture */}
      <section className="space-y-4 rounded-xl border border-border/50 bg-card p-5">
        <div>
          <h2 className="font-medium text-base text-card-foreground">
            Passive Capture
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            Configure global settings for passive capture when browsing
            normally. Excluded domains above are never captured.
          </p>
        </div>

        <div className="space-y-4 divide-y divide-border/30">
          <div className="flex items-center justify-between pt-0">
            <div className="space-y-0.5 pr-8">
              <span className="font-medium text-card-foreground text-xs">
                Learn from pages I browse
              </span>
              <p className="text-[10px] text-muted-foreground">
                Pane observes page structure on sites you visit and stages
                workflow learnings for your review.
              </p>
            </div>
            <Switch
              checked={browsingOn}
              onCheckedChange={handleToggleBrowsing}
            />
          </div>

          <div className="flex items-center justify-between pt-4">
            <div className="space-y-0.5 pr-8">
              <span className="font-medium text-card-foreground text-xs">
                Research thread tracking
              </span>
              <p className="text-[10px] text-muted-foreground">
                When active, Pane records the chain of pages you visit with
                verbatim quotes for citable context search.
              </p>
            </div>
            <Switch
              checked={researchOn}
              onCheckedChange={handleToggleResearch}
            />
          </div>
        </div>
      </section>

      {/* Section 3: Meeting Capture */}
      <section className="space-y-4 rounded-xl border border-border/50 bg-card p-5">
        <div>
          <h2 className="font-medium text-base text-card-foreground">
            Meeting Capture
          </h2>
          <p className="mt-0.5 text-muted-foreground text-xs">
            Add sites where Pane should auto-start transcription and notes when
            you join a call.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              className="h-9 w-64 text-xs"
              placeholder="e.g. meet.google.com"
              value={meetingInput}
              onChange={(e) => setMeetingInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddMeetingDomain()
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-4 text-xs"
              onClick={handleAddMeetingDomain}
            >
              Add Domain
            </Button>
          </div>

          {consents.loading && (
            <p className="text-muted-foreground text-sm">
              Loading meeting domains…
            </p>
          )}

          {!consents.loading && meetingDomains.length === 0 && (
            <p className="text-muted-foreground text-xs italic">
              No meeting domains added. Auto-transcription is off.
            </p>
          )}

          {meetingDomains.length > 0 && (
            <ul className="space-y-2">
              {meetingDomains.map((domain) => {
                const consent = meetingConsents.find((c) => c.domain === domain)
                return (
                  <li
                    key={domain}
                    className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5"
                  >
                    <span className="max-w-xs truncate font-medium text-xs">
                      {domain}
                    </span>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                        <Switch
                          checked={consent?.allowed ?? false}
                          onCheckedChange={(allowed) =>
                            consents.setConsent.mutate({
                              domain,
                              class: 'meeting',
                              allowed,
                              bucketId: consent?.bucketId ?? bucketId,
                            })
                          }
                        />
                        <span className="font-medium text-xs">Auto-start</span>
                      </div>

                      <Select
                        value={consent?.bucketId ?? bucketId}
                        onValueChange={(nextBucketId) =>
                          reassignDomainBucket(domain, nextBucketId)
                        }
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
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
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
