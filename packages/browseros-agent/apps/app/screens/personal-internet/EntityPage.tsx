/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { entityHref } from '@/lib/personal-internet/pi-href'
import { executePiAction, refreshPiPageWithAgent } from '@/lib/pi-actions'
import { emitPiInvalidate } from '@/lib/pi-invalidate'
import { PiFieldSurface, piEntityField } from './field'
import {
  MaterializeActivityBar,
  type PendingMaterializeApproval,
} from './MaterializeActivityBar'
import type {
  MaterializeActivityLine,
  MaterializeActivitySnapshot,
} from './materializeActivity'
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
import {
  piDelete,
  piPost,
  usePiInvalidateListener,
  usePiPage,
} from './usePiApi'

const MATERIALIZE_TIMEOUT_MS = 90_000
const BTF_DEBOUNCE_MS = 300

type EnsureResult = {
  pageId: string
  company: string
  entityKey: string
  atfReady: boolean
  btfComplete: boolean
  phase: string
  runId?: string
  conversationId?: string | null
}

let lastPiFocus: {
  runId?: string
  conversationId?: string | null
} = {}

/** Debounced focus release so React Strict Mode remount does not cancel BTF. */
const pendingFocusReleases = new Map<string, number>()

function scheduleFocusRelease(siteId: string, pageId: string): void {
  const key = `${siteId}:${pageId}`
  const prev = pendingFocusReleases.get(key)
  if (prev != null) window.clearTimeout(prev)
  const timer = window.setTimeout(() => {
    pendingFocusReleases.delete(key)
    void piDelete(
      `/pi/focus?siteId=${encodeURIComponent(siteId)}&pageId=${encodeURIComponent(pageId)}`,
    ).catch(() => undefined)
  }, 150)
  pendingFocusReleases.set(key, timer)
}

function cancelScheduledFocusRelease(siteId: string, pageId: string): void {
  const key = `${siteId}:${pageId}`
  const timer = pendingFocusReleases.get(key)
  if (timer == null) return
  window.clearTimeout(timer)
  pendingFocusReleases.delete(key)
}

async function cancelPriorConversation(
  conversationId: string | null | undefined,
): Promise<void> {
  if (!conversationId) return
  try {
    const base = await getAgentServerUrl()
    await agentFetch(
      `${base}/chat/${encodeURIComponent(conversationId)}/cancel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'pi-focus-switched' }),
      },
    )
  } catch {
    // best-effort
  }
}

async function pollRunForWatch(runId: string): Promise<{
  conversationId: string | null
  status?: string
}> {
  const base = await getAgentServerUrl()
  let conversationId: string | null = null
  let status: string | undefined
  for (let i = 0; i < 20; i++) {
    const res = await agentFetch(
      `${base}/scheduler/runs/${encodeURIComponent(runId)}`,
    )
    if (res.ok) {
      const body = (await res.json()) as {
        run?: { conversationId?: string | null; status?: string }
      }
      status = body.run?.status
      conversationId = body.run?.conversationId ?? conversationId
      if (
        conversationId ||
        status === 'cancelled' ||
        status === 'failed' ||
        status === 'completed'
      ) {
        break
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return { conversationId, status }
}

export const EntityPage: FC = () => {
  const { siteId, entityKey: rawKey } = useParams()
  usePiInvalidateListener()
  const entityKey = rawKey ? decodeURIComponent(rawKey) : undefined
  const [pageId, setPageId] = useState<string | null>(null)
  const [company, setCompany] = useState<string>('')
  const [refreshing, setRefreshing] = useState(false)
  const [ensureError, setEnsureError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [btfComplete, setBtfComplete] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)
  const [openingOwner, setOpeningOwner] = useState(false)
  const [activityLines, setActivityLines] = useState<MaterializeActivityLine[]>(
    [],
  )
  const [toolWaiting, setToolWaiting] = useState(false)
  const [pendingApproval, setPendingApproval] =
    useState<PendingMaterializeApproval | null>(null)
  const [resolvingApproval, setResolvingApproval] = useState(false)
  const pageQuery = usePiPage(siteId, pageId ?? undefined)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const enrichSinceRef = useRef<number | null>(null)
  const debounceRef = useRef<number | null>(null)
  const mountedKeyRef = useRef<string>('')
  const pageIdRef = useRef<string | null>(null)
  const field = piEntityField(siteId, entityKey)

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ensure lifecycle + stale-response guards
  const ensure = async (opts: { materialize: boolean; force?: boolean }) => {
    if (!siteId || !entityKey) return
    const requestKey = `${siteId}:${entityKey}`
    setLoading(true)
    setEnsureError(null)
    setTimedOut(false)
    try {
      const res = await piPost(
        `/pi/sites/${siteId}/entities/${encodeURIComponent(entityKey)}/ensure`,
        {
          materialize: opts.materialize,
          force: opts.force,
        },
      )
      if (!res.ok) {
        if (mountedKeyRef.current === requestKey) {
          setEnsureError(`Ensure failed (${res.status})`)
        }
        return
      }
      const data = (await res.json()) as EnsureResult
      // Left this entity (or unmounted) while ensure was in flight — drop focus/run.
      if (mountedKeyRef.current !== requestKey) {
        void piDelete(
          `/pi/focus?siteId=${encodeURIComponent(siteId)}&pageId=${encodeURIComponent(data.pageId)}`,
        ).catch(() => undefined)
        return
      }
      cancelScheduledFocusRelease(siteId, data.pageId)
      pageIdRef.current = data.pageId
      setPageId(data.pageId)
      setCompany(data.company || entityKey)
      setWatchError(null)
      setBtfComplete(Boolean(data.btfComplete))
      setEnriching(Boolean(data.runId) && !data.btfComplete)
      setRunId(data.runId ?? null)
      setConversationId(data.conversationId ?? null)
      if (data.runId) {
        await cancelPriorConversation(lastPiFocus.conversationId)
        if (mountedKeyRef.current !== requestKey) {
          void piDelete(
            `/pi/focus?siteId=${encodeURIComponent(siteId)}&pageId=${encodeURIComponent(data.pageId)}`,
          ).catch(() => undefined)
          return
        }
        lastPiFocus = {
          runId: data.runId,
          conversationId: data.conversationId,
        }
      }
      emitPiInvalidate(siteId)

      if (data.runId && opts.materialize && !data.btfComplete) {
        enrichSinceRef.current = Date.now()
        if (debounceRef.current != null) {
          window.clearTimeout(debounceRef.current)
        }
        const nudgeRunId = data.runId
        debounceRef.current = window.setTimeout(() => {
          if (mountedKeyRef.current !== requestKey) return
          void import('@/lib/schedules/nudgeDrainServerRuns')
            .then(({ nudgeDrainServerRuns }) =>
              nudgeDrainServerRuns({ runIds: [nudgeRunId] }),
            )
            .catch(() => undefined)
        }, BTF_DEBOUNCE_MS)
      } else {
        enrichSinceRef.current = null
      }
    } catch (e) {
      if (mountedKeyRef.current === requestKey) {
        setEnsureError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      if (mountedKeyRef.current === requestKey) {
        setLoading(false)
      }
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: ensure once per route params
  useEffect(() => {
    if (!siteId || !entityKey) return
    mountedKeyRef.current = `${siteId}:${entityKey}`
    // Clear prior entity so we never flash the previous company doc.
    pageIdRef.current = null
    setPageId(null)
    setCompany('')
    setBtfComplete(false)
    setEnriching(false)
    setTimedOut(false)
    setRunId(null)
    setConversationId(null)
    setEnsureError(null)
    setWatchError(null)
    void ensure({ materialize: true })
    return () => {
      mountedKeyRef.current = ''
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const pid = pageIdRef.current
      if (pid) {
        scheduleFocusRelease(siteId, pid)
      }
    }
  }, [siteId, entityKey])

  // Poll while enriching; surface timeout; pick up conversationId.
  useEffect(() => {
    if (!enriching || !pageId || !siteId) return
    if (enrichSinceRef.current == null) enrichSinceRef.current = Date.now()
    const id = window.setInterval(() => {
      const started = enrichSinceRef.current
      if (started != null && Date.now() - started > MATERIALIZE_TIMEOUT_MS) {
        setTimedOut(true)
      }
      void pageQuery.refetch().then((r) => {
        const doc = r.data?.doc
        if (!doc) return
        const phase = doc.meta?.materialize?.phase
        if (phase === 'done') {
          setBtfComplete(true)
          setEnriching(false)
          setTimedOut(false)
          enrichSinceRef.current = null
          emitPiInvalidate(siteId)
        }
      })
      if (runId) {
        void getAgentServerUrl()
          .then((base) =>
            agentFetch(`${base}/scheduler/runs/${encodeURIComponent(runId)}`),
          )
          .then(async (res) => {
            if (!res.ok) return
            const body = (await res.json()) as {
              run?: { conversationId?: string | null; status?: string }
            }
            if (body.run?.conversationId) {
              setConversationId(body.run.conversationId)
              lastPiFocus.conversationId = body.run.conversationId
            }
            const status = body.run?.status
            if (status === 'completed') {
              void pageQuery.refetch().then((r) => {
                const phase = r.data?.doc?.meta?.materialize?.phase
                if (phase === 'done') {
                  setBtfComplete(true)
                  setEnriching(false)
                  setTimedOut(false)
                  enrichSinceRef.current = null
                  emitPiInvalidate(siteId)
                } else {
                  // Agent finished without marking done — stop spinner, allow retry.
                  setEnriching(false)
                  setBtfComplete(false)
                }
              })
            } else if (status === 'failed' || status === 'cancelled') {
              setEnriching(false)
              setBtfComplete(false)
            }
          })
          .catch(() => undefined)
      }
    }, 2500)
    return () => window.clearInterval(id)
  }, [enriching, pageId, pageQuery, siteId, runId])

  // Rolling owner-agent activity + pending channel approvals (never leave user dark).
  useEffect(() => {
    if (!enriching || !conversationId) {
      setActivityLines([])
      setToolWaiting(false)
      setPendingApproval(null)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const base = await getAgentServerUrl()
        const [activityRes, approvalsRes] = await Promise.all([
          agentFetch(
            `${base}/chat/${encodeURIComponent(conversationId)}/activity?limit=4`,
          ),
          agentFetch(`${base}/scheduler/approvals`),
        ])
        if (cancelled) return
        if (activityRes.ok) {
          const snap = (await activityRes.json()) as MaterializeActivitySnapshot
          setActivityLines(snap.lines ?? [])
          setToolWaiting(Boolean(snap.toolWaiting))
        }
        if (approvalsRes.ok) {
          const body = (await approvalsRes.json()) as {
            approvals?: Array<{
              conversationId?: string | null
              toolName: string
              preview: string
              approveToken: string
              denyToken: string
              status: string
            }>
          }
          const match = (body.approvals ?? []).find(
            (a) =>
              a.status === 'pending' && a.conversationId === conversationId,
          )
          setPendingApproval(
            match
              ? {
                  toolName: match.toolName,
                  preview: match.preview,
                  approveToken: match.approveToken,
                  denyToken: match.denyToken,
                }
              : null,
          )
        }
      } catch {
        // best-effort
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [enriching, conversationId])

  const resolveApproval = async (token: string) => {
    setResolvingApproval(true)
    try {
      const base = await getAgentServerUrl()
      await agentFetch(`${base}/scheduler/approvals/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setPendingApproval(null)
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : String(e))
    } finally {
      setResolvingApproval(false)
    }
  }

  const openOwnerAgent = async () => {
    if (openingOwner) return
    setOpeningOwner(true)
    setWatchError(null)
    try {
      let conv = conversationId
      let runStatus: string | undefined
      if (runId) {
        try {
          const polled = await pollRunForWatch(runId)
          runStatus = polled.status
          conv = polled.conversationId ?? conv
          if (conv) setConversationId(conv)
        } catch {
          // fall through with whatever conversationId we already have
        }
      }
      if (runStatus === 'cancelled' || runStatus === 'failed') {
        setWatchError(
          runStatus === 'cancelled'
            ? 'Materialize was cancelled. Use Retry prep to try again.'
            : 'Materialize failed. Use Retry prep to try again.',
        )
        setEnriching(false)
        return
      }
      if (conv) {
        await openSidePanelWithSearch('open', {
          requestId: crypto.randomUUID(),
          query: '',
          mode: 'agent',
          conversationId: conv,
        })
        return
      }
      // Never open a fresh unrelated chat — that hides the materialize turn.
      setWatchError(
        'Owner agent is not ready yet. Wait a moment and try again.',
      )
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpeningOwner(false)
    }
  }

  if (!siteId || !entityKey) {
    return <div className="p-6 text-destructive text-sm">Missing entity.</div>
  }

  if (loading && !pageId) {
    return (
      <PiFieldSurface field={field}>
        <div className="p-6 text-muted-foreground text-sm">
          Opening company page…
        </div>
      </PiFieldSurface>
    )
  }

  if (ensureError) {
    return (
      <PiFieldSurface field={field}>
        <div className="flex flex-col gap-3 p-6">
          <div className="text-destructive text-sm">{ensureError}</div>
          <PiRailAction onClick={() => void ensure({ materialize: true })}>
            Retry
          </PiRailAction>
        </div>
      </PiFieldSurface>
    )
  }

  const doc = pageQuery.data?.doc
  const title = doc?.title || company || entityKey
  const needsApproval = Boolean(pendingApproval) || toolWaiting
  const statusLabel =
    needsApproval && enriching
      ? 'Needs approval'
      : timedOut && enriching
        ? 'Prep timed out'
        : enriching
          ? 'Creating…'
          : btfComplete
            ? 'Ready'
            : 'Loading…'
  const showActivityBar = Boolean(enriching || (runId && !btfComplete))

  return (
    <PiFieldSurface field={field}>
      <div className="flex min-h-full flex-col">
        <PiTopRail
          crumbs={[title]}
          status={
            <PiStatusDot label={statusLabel} live={enriching || !!runId} />
          }
          actions={
            <>
              {siteId && entityKey ? (
                <>
                  <PiAddressChip href={entityHref(siteId, entityKey)} />
                  <PiLinkActions
                    href={entityHref(siteId, entityKey)}
                    bookmarkTitle={title}
                  />
                </>
              ) : null}
              {enriching || timedOut ? (
                <PiRailAction
                  onClick={() =>
                    void ensure({ materialize: true, force: true })
                  }
                >
                  Retry prep
                </PiRailAction>
              ) : null}
              {pageId && !enriching ? (
                <PiRailAction
                  disabled={refreshing}
                  onClick={() => {
                    setRefreshing(true)
                    void refreshPiPageWithAgent({
                      siteId,
                      pageId,
                      pageTitle: title,
                      entityKey,
                      company: company || undefined,
                    }).finally(() => setRefreshing(false))
                  }}
                >
                  {refreshing ? 'Refreshing…' : 'Refresh'}
                </PiRailAction>
              ) : null}
              <PiRailAction to={`/pi/sites/${siteId}`}>
                Back to site
              </PiRailAction>
            </>
          }
        />
        {enriching && !timedOut && !needsApproval ? (
          <div className="border-border border-b px-5 py-2 font-mono text-[11px] text-muted-foreground tracking-wide">
            {company
              ? `Creating your website for ${company}…`
              : 'Creating your website…'}
          </div>
        ) : null}
        {timedOut && enriching && !needsApproval ? (
          <div className="border-border border-b px-5 py-2 font-mono text-[11px] text-muted-foreground tracking-wide">
            Still creating your website. Retry prep, or open the owner agent.
          </div>
        ) : null}
        {watchError ? (
          <div className="border-border border-b px-5 py-2 font-mono text-[11px] text-muted-foreground tracking-wide">
            {watchError}
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          {doc && pageId ? (
            <PiPageErrorBoundary
              siteId={siteId}
              pageId={pageId}
              pageTitle={title}
              entityKey={entityKey}
              issues={pageQuery.data?.issues}
              fixHint={pageQuery.data?.fixHint}
              agentBrief={pageQuery.data?.diagnosis?.agentBrief}
              findings={pageQuery.data?.diagnosis?.findings}
              contentSummary={pageQuery.data?.contentSummary}
            >
              <PiPageRenderer
                doc={doc}
                siteId={siteId}
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
            </PiPageErrorBoundary>
          ) : pageId && !pageQuery.isLoading ? (
            <PiBrokenPagePanel
              siteId={siteId}
              pageId={pageId}
              pageTitle={title}
              entityKey={entityKey}
              issues={pageQuery.data?.issues}
              fixHint={pageQuery.data?.fixHint}
              agentBrief={pageQuery.data?.diagnosis?.agentBrief}
              findings={pageQuery.data?.diagnosis?.findings}
              contentSummary={pageQuery.data?.contentSummary}
            />
          ) : (
            <div className="p-6 text-muted-foreground text-sm">
              Loading page…
            </div>
          )}
        </div>
        {showActivityBar ? (
          <MaterializeActivityBar
            lines={activityLines}
            needsApproval={needsApproval}
            pendingApproval={pendingApproval}
            openingOwner={openingOwner}
            resolvingApproval={resolvingApproval}
            onOpenOwner={() => void openOwnerAgent()}
            onApprove={() => {
              if (pendingApproval)
                void resolveApproval(pendingApproval.approveToken)
            }}
            onDeny={() => {
              if (pendingApproval)
                void resolveApproval(pendingApproval.denyToken)
            }}
          />
        ) : null}
      </div>
    </PiFieldSurface>
  )
}
