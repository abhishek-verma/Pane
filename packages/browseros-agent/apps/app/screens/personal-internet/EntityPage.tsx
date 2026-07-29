/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { executePiAction } from '@/lib/pi-actions'
import { emitPiInvalidate } from '@/lib/pi-invalidate'
import { PiPageRenderer } from './PiPageRenderer'
import {
  piPost,
  usePiInvalidateListener,
  usePiPage,
  usePiSite,
} from './usePiApi'

const MATERIALIZE_TIMEOUT_MS = 90_000

export const EntityPage: FC = () => {
  const { siteId, entityKey: rawKey } = useParams()
  usePiInvalidateListener()
  const entityKey = rawKey ? decodeURIComponent(rawKey) : undefined
  const siteQuery = usePiSite(siteId)
  const [pageId, setPageId] = useState<string | null>(null)
  const [ensureError, setEnsureError] = useState<string | null>(null)
  const [ensuring, setEnsuring] = useState(false)
  const [stub, setStub] = useState(true)
  const [timedOut, setTimedOut] = useState(false)
  const pageQuery = usePiPage(siteId, pageId ?? undefined)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const stubSinceRef = useRef<number | null>(null)

  const ensure = async (materialize = true) => {
    if (!siteId || !entityKey) return
    setEnsuring(true)
    setEnsureError(null)
    setTimedOut(false)
    stubSinceRef.current = Date.now()
    try {
      const res = await piPost(
        `/pi/sites/${siteId}/entities/${encodeURIComponent(entityKey)}/ensure`,
        { materialize },
      )
      if (!res.ok) {
        setEnsureError(`Ensure failed (${res.status})`)
        return
      }
      const data = (await res.json()) as {
        pageId: string
        stub: boolean
      }
      setPageId(data.pageId)
      setStub(data.stub)
      if (!data.stub) stubSinceRef.current = null
      emitPiInvalidate(siteId)
      // Materialize enqueues a scheduled_run; nudge drain so prep does not
      // wait for the 1-minute background alarm (S4).
      if (data.stub && materialize) {
        void import('@/lib/schedules/nudgeDrainServerRuns')
          .then(({ nudgeDrainServerRuns }) => nudgeDrainServerRuns())
          .catch(() => undefined)
      }
    } catch (e) {
      setEnsureError(e instanceof Error ? e.message : String(e))
    } finally {
      setEnsuring(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: ensure once per route params
  useEffect(() => {
    void ensure(true)
  }, [siteId, entityKey])

  // Poll while stub / refreshing; surface timeout if agent never fills page.
  useEffect(() => {
    if (!stub || !pageId) return
    if (stubSinceRef.current == null) stubSinceRef.current = Date.now()
    const id = window.setInterval(() => {
      const started = stubSinceRef.current
      if (started != null && Date.now() - started > MATERIALIZE_TIMEOUT_MS) {
        setTimedOut(true)
      }
      void pageQuery.refetch().then((r) => {
        const doc = r.data?.doc
        const stillStub = doc?.nodes.some(
          (n) =>
            n.type === 'note' && String(n.text).includes('Preparing details'),
        )
        if (stillStub === false) {
          setStub(false)
          setTimedOut(false)
          stubSinceRef.current = null
          emitPiInvalidate(siteId)
        }
      })
    }, 2500)
    return () => window.clearInterval(id)
  }, [stub, pageId, pageQuery, siteId])

  if (!siteId || !entityKey) {
    return <div className="p-6 text-destructive text-sm">Missing entity.</div>
  }

  if (ensuring && !pageId) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Preparing {entityKey}…
      </div>
    )
  }

  if (ensureError) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="text-destructive text-sm">{ensureError}</div>
        <Button size="sm" onClick={() => void ensure(true)}>
          Retry
        </Button>
      </div>
    )
  }

  const doc = pageQuery.data?.doc
  const company = siteQuery.data?.site.name

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-border/60 border-b px-4 py-3">
        <div>
          <div className="font-medium text-foreground text-sm">
            {doc?.title ?? entityKey}
          </div>
          <div className="text-muted-foreground text-xs">
            {company ? `${company} · ` : ''}
            {timedOut && stub
              ? 'Prep timed out — retry or ask chat'
              : stub
                ? 'Preparing details…'
                : 'Company details'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stub ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void ensure(true)}
            >
              Retry prep
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost">
            <Link to={`/pi/sites/${siteId}`}>Back to site</Link>
          </Button>
        </div>
      </div>
      {timedOut && stub ? (
        <div className="border-border/60 border-b bg-muted/40 px-4 py-2 text-muted-foreground text-xs">
          Details are still preparing. Retry prep, or ask chat to materialize
          this company.
        </div>
      ) : null}
      {doc ? (
        <PiPageRenderer
          doc={doc}
          pendingKey={pendingKey}
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
        <div className="p-6 text-muted-foreground text-sm">Loading page…</div>
      )}
    </div>
  )
}
