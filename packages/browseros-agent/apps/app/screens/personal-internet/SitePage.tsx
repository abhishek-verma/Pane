/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { executePiAction } from '@/lib/pi-actions'
import { PiPageRenderer } from './PiPageRenderer'
import { RecordsPanel } from './RecordsPanel'
import {
  piPatch,
  piPost,
  usePiInvalidateListener,
  usePiPage,
  usePiSite,
} from './usePiApi'

function formatAsOf(iso?: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export const SitePage: FC = () => {
  const { siteId, pageId } = useParams()
  usePiInvalidateListener()
  const siteQuery = usePiSite(siteId)
  const resolvedPageId =
    pageId ??
    siteQuery.data?.pages.find((p) => p.kind === 'index')?.id ??
    siteQuery.data?.pages[0]?.id
  const pageQuery = usePiPage(siteId, resolvedPageId)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  if (siteQuery.isLoading || pageQuery.isLoading) {
    return (
      <div className="p-6 text-muted-foreground text-sm">Loading site…</div>
    )
  }
  if (siteQuery.error || !siteQuery.data) {
    return (
      <div className="p-6 text-destructive text-sm">Could not load site.</div>
    )
  }

  const { site, pulse, pages } = siteQuery.data
  const doc = pageQuery.data?.doc
  const staleAt = pulse?.staleAt
  const asOf = formatAsOf(pulse?.lastUpdatedAt)

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-border/60 border-b px-4 py-3">
        <div>
          <div className="font-medium text-foreground text-sm">{site.name}</div>
          {pulse?.pulseLine ? (
            <div className="text-muted-foreground text-xs">
              {pulse.pulseLine}
              {asOf ? ` · as of ${asOf}` : ''}
              {staleAt ? (
                <span className="ml-2 text-amber-700 dark:text-amber-300">
                  Stale since {formatAsOf(staleAt)}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => {
              if (!siteId) return
              setRefreshing(true)
              void piPost('/pi/refresh', {
                siteId,
                trigger: 'manual-refresh',
              })
                .then(() => {
                  void siteQuery.refetch()
                  void pageQuery.refetch()
                })
                .finally(() => setRefreshing(false))
            }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/pi/library">Library</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/home">Home</Link>
          </Button>
        </div>
      </div>
      {pages.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-border/40 border-b px-4 py-2">
          {pages.map((p) => (
            <Link
              key={p.id}
              to={`/pi/sites/${siteId}/pages/${p.id}`}
              className="whitespace-nowrap rounded-full px-3 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground"
            >
              {p.title}
            </Link>
          ))}
        </div>
      ) : null}
      {doc ? (
        <PiPageRenderer
          doc={doc}
          pendingKey={pendingKey}
          onMoveCard={async (cardId, toColumnId) => {
            if (!resolvedPageId) return
            await piPatch(`/pi/pages/${resolvedPageId}`, {
              ops: [{ op: 'moveBoardCard', cardId, toColumnId }],
            })
            void siteQuery.refetch()
            void pageQuery.refetch()
          }}
          onAction={async (action, ctx) => {
            if (ctx?.pendingKey) setPendingKey(ctx.pendingKey)
            try {
              await executePiAction(action)
            } finally {
              setPendingKey(null)
            }
          }}
        />
      ) : (
        <div className="p-6 text-muted-foreground text-sm">
          No page content.
        </div>
      )}
      {siteId ? <RecordsPanel siteId={siteId} /> : null}
    </div>
  )
}
