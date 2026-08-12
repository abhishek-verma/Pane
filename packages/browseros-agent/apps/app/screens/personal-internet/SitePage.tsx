/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { pageHref, siteHref } from '@/lib/personal-internet/pi-href'
import { executePiAction, refreshPiPageWithAgent } from '@/lib/pi-actions'
import { cn } from '@/lib/utils'
import { PiFieldSurface, piSiteField } from './field'
import { PiBrokenPagePanel } from './PiBrokenPagePanel'
import {
  PiAddressChip,
  PiLinkActions,
  PiRailAction,
  PiStatusDot,
  PiTopRail,
} from './PiChrome'
import { PiPageErrorBoundary } from './PiPageErrorBoundary'
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

async function archiveCurrentPage(
  _siteId: string,
  pageId: string,
  pageTitle: string,
  onDone: () => void,
): Promise<void> {
  if (!window.confirm(`Archive "${pageTitle}"?`)) return
  await piPost(`/pi/pages/${pageId}/archive`)
  onDone()
}

const PageArchiveAction: FC<{
  siteId?: string
  pageId?: string
  pageTitle: string
}> = ({ siteId, pageId, pageTitle }) => {
  const navigate = useNavigate()
  if (!siteId || !pageId) return null
  return (
    <PiRailAction
      variant="destructive"
      onClick={() =>
        void archiveCurrentPage(siteId, pageId, pageTitle, () =>
          navigate(siteHref(siteId)),
        )
      }
    >
      Archive
    </PiRailAction>
  )
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
  const field = piSiteField(siteId)

  if (siteQuery.isLoading || pageQuery.isLoading) {
    return (
      <PiFieldSurface field={field}>
        <div className="p-6 text-muted-foreground text-sm">Loading site…</div>
      </PiFieldSurface>
    )
  }
  if (siteQuery.error || !siteQuery.data) {
    return (
      <PiFieldSurface field={field}>
        <div className="p-6 text-destructive text-sm">Could not load site.</div>
      </PiFieldSurface>
    )
  }

  const { site, pulse, pages } = siteQuery.data
  const doc = pageQuery.data?.doc
  const pageIssues = pageQuery.data?.issues ?? []
  const pageBroken = Boolean(resolvedPageId) && !doc
  const staleAt = pulse?.staleAt
  const asOf = formatAsOf(pulse?.lastUpdatedAt)

  const statusLabel = staleAt
    ? `Stale · ${formatAsOf(staleAt)}`
    : asOf
      ? `As of ${asOf}`
      : pulse?.pulseLine
        ? 'Live'
        : 'Idle'

  return (
    <PiFieldSurface field={field}>
      <PiTopRail
        crumbs={[site.name]}
        status={<PiStatusDot label={statusLabel} live={!staleAt && !!pulse} />}
        actions={
          <>
            {siteId ? (
              <>
                <PiAddressChip
                  href={
                    pageId && resolvedPageId
                      ? pageHref(siteId, resolvedPageId)
                      : siteHref(siteId)
                  }
                />
                <PiLinkActions
                  href={
                    pageId && resolvedPageId
                      ? pageHref(siteId, resolvedPageId)
                      : siteHref(siteId)
                  }
                  bookmarkTitle={doc?.title || site.name}
                />
              </>
            ) : null}
            <PiRailAction
              disabled={refreshing || !resolvedPageId}
              onClick={() => {
                if (!siteId || !resolvedPageId) return
                setRefreshing(true)
                void refreshPiPageWithAgent({
                  siteId,
                  pageId: resolvedPageId,
                  pageTitle: doc?.title || site.name,
                }).finally(() => setRefreshing(false))
              }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </PiRailAction>
            <PageArchiveAction
              siteId={siteId}
              pageId={resolvedPageId}
              pageTitle={doc?.title || site.name}
            />
            <PiRailAction to="/pi/library">Library</PiRailAction>
            <PiRailAction to="/home">Home</PiRailAction>
          </>
        }
      />
      {pulse?.pulseLine ? (
        <div className="border-border border-b px-5 py-2 font-mono text-[11px] text-muted-foreground tracking-wide">
          {pulse.pulseLine}
        </div>
      ) : null}
      {pages.length > 1 ? (
        <div className="flex gap-0 overflow-x-auto border-border border-b px-5">
          {pages.map((p) => {
            // Prefer bound meta.entityKey — never slugify title (BTF may rename).
            const entityKey =
              p.kind === 'entity' && p.entityKey?.trim()
                ? p.entityKey.trim()
                : null
            const to =
              entityKey && siteId
                ? `/pi/sites/${siteId}/entities/${encodeURIComponent(entityKey)}`
                : `/pi/sites/${siteId}/pages/${p.id}`
            const active = resolvedPageId === p.id
            return (
              <Link
                key={p.id}
                to={to}
                className={cn(
                  'whitespace-nowrap border-transparent border-b-2 px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors',
                  active
                    ? 'border-foreground text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.title}
              </Link>
            )
          })}
        </div>
      ) : null}
      {doc && siteId && resolvedPageId ? (
        <PiPageErrorBoundary
          siteId={siteId}
          pageId={resolvedPageId}
          pageTitle={doc.title || site.name}
          issues={pageIssues}
          fixHint={pageQuery.data?.fixHint}
          agentBrief={pageQuery.data?.diagnosis?.agentBrief}
          findings={pageQuery.data?.diagnosis?.findings}
          contentSummary={pageQuery.data?.contentSummary}
        >
          <PiPageRenderer
            doc={doc}
            siteId={siteId}
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
        </PiPageErrorBoundary>
      ) : pageBroken && siteId && resolvedPageId ? (
        <PiBrokenPagePanel
          siteId={siteId}
          pageId={resolvedPageId}
          pageTitle={pageQuery.data?.page?.title || site.name}
          issues={pageIssues}
          fixHint={pageQuery.data?.fixHint}
          agentBrief={pageQuery.data?.diagnosis?.agentBrief}
          findings={pageQuery.data?.diagnosis?.findings}
          contentSummary={pageQuery.data?.contentSummary}
        />
      ) : (
        <div className="p-6 text-muted-foreground text-sm">
          No page content.
        </div>
      )}
      {siteId ? <RecordsPanel siteId={siteId} /> : null}
    </PiFieldSurface>
  )
}
