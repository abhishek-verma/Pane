/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  type ContextNode,
  useContextBuckets,
  useContextCurrent,
  useContextGrants,
} from './useContextApi'

function NodeList({ title, nodes }: { title: string; nodes: ContextNode[] }) {
  if (nodes.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="font-medium text-sm">{title}</h2>
      <ul className="space-y-2">
        {nodes.map((n) => (
          <li
            key={n.id}
            className="rounded-lg border bg-card px-3 py-2 text-sm"
          >
            <div className="font-medium">{n.title ?? '(untitled)'}</div>
            {n.uri && (
              <div className="truncate text-muted-foreground text-xs">
                {n.uri}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export const ContextPage: FC = () => {
  const { buckets, loading: bucketsLoading } = useContextBuckets()
  const [bucketId, setBucketId] = useState('default')
  const { data, loading, error, refetch } = useContextCurrent(bucketId)
  const {
    grants,
    visitedDomains,
    setGrant,
    loading: grantsLoading,
  } = useContextGrants(bucketId)

  const work = data?.work
  const empty =
    work &&
    work.tabs.length === 0 &&
    work.pages.length === 0 &&
    work.files.length === 0 &&
    work.terminal.length === 0 &&
    work.runs.length === 0

  const grantByDomain = new Map(grants.map((g) => [g.domain, g]))
  const domains = [
    ...new Set([...visitedDomains, ...grants.map((g) => g.domain)]),
  ].sort()

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Context</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            What Pane knows about your work on this device.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
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
            ).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data?.indexingPaused && (
          <span className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-700 text-xs dark:text-amber-300">
            Indexing paused
            {data.pauseReason ? ` (${data.pauseReason})` : ' (battery)'}
          </span>
        )}
      </div>

      {(loading || bucketsLoading) && (
        <p className="text-muted-foreground text-sm">Loading context…</p>
      )}
      {error && (
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'Failed to load context'}
        </p>
      )}

      {!loading && !error && empty && (
        <p className="text-muted-foreground text-sm">
          Nothing indexed yet. Browse with the agent, write a file, or run a
          terminal command to fill this view.
        </p>
      )}

      {work && !empty && (
        <div className="grid gap-6 md:grid-cols-2">
          <NodeList title="Pages" nodes={work.pages} />
          <NodeList title="Tabs" nodes={work.tabs} />
          <NodeList title="Files" nodes={work.files} />
          <NodeList title="Terminal" nodes={work.terminal} />
          <NodeList title="Agent runs" nodes={work.runs} />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-medium text-sm">Domain grants</h2>
        <p className="text-muted-foreground text-xs">
          Deny a domain to hide its pages from context search and current work.
        </p>
        {grantsLoading && (
          <p className="text-muted-foreground text-sm">Loading grants…</p>
        )}
        {domains.length === 0 && !grantsLoading && (
          <p className="text-muted-foreground text-sm">
            No visited domains yet.
          </p>
        )}
        <ul className="space-y-2">
          {domains.map((domain) => {
            const grant = grantByDomain.get(domain)
            const allowed = grant?.allowed ?? true
            return (
              <li
                key={domain}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
              >
                <span>{domain}</span>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {allowed ? 'Allowed' : 'Denied'}
                  </span>
                  <Switch
                    checked={allowed}
                    onCheckedChange={(next) =>
                      setGrant.mutate({ domain, allowed: next })
                    }
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
