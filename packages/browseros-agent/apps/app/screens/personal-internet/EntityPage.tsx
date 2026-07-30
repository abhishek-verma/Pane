/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { executePiAction } from '@/lib/pi-actions'
import { emitPiInvalidate } from '@/lib/pi-invalidate'
import { PiFieldSurface, piEntityField } from './field'
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

export const EntityPage: FC = () => {
  const { siteId, entityKey: rawKey } = useParams()
  usePiInvalidateListener()
  const entityKey = rawKey ? decodeURIComponent(rawKey) : undefined
  const [pageId, setPageId] = useState<string | null>(null)
  const [company, setCompany] = useState<string>('')
  const [ensureError, setEnsureError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [btfComplete, setBtfComplete] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [timedOut, setTimedOut] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)
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

  const watchAgent = async () => {
    setWatchError(null)
    let conv = conversationId
    if (!conv && runId) {
      try {
        const base = await getAgentServerUrl()
        for (let i = 0; i < 20 && !conv; i++) {
          const res = await agentFetch(
            `${base}/scheduler/runs/${encodeURIComponent(runId)}`,
          )
          if (res.ok) {
            const body = (await res.json()) as {
              run?: { conversationId?: string | null }
            }
            conv = body.run?.conversationId ?? null
            if (conv) {
              setConversationId(conv)
              break
            }
          }
          await new Promise((r) => setTimeout(r, 500))
        }
      } catch {
        // fall through
      }
    }
    if (conv) {
      await openSidePanelWithSearch('open', {
        query: '',
        mode: 'agent',
        conversationId: conv,
      })
      return
    }
    // Never open a fresh unrelated chat — that hides the materialize turn.
    setWatchError(
      'Agent conversation is not ready yet. Wait a moment and try Watch agent again.',
    )
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
          <Button size="sm" onClick={() => void ensure({ materialize: true })}>
            Retry
          </Button>
        </div>
      </PiFieldSurface>
    )
  }

  const doc = pageQuery.data?.doc
  const title = doc?.title || company || entityKey

  return (
    <PiFieldSurface field={field}>
      <div className="flex items-center justify-between gap-3 border-border/60 border-b px-4 py-3">
        <div>
          <div className="font-medium text-foreground text-sm">{title}</div>
          <div className="text-muted-foreground text-xs">
            {timedOut && enriching
              ? 'Prep timed out — retry or ask chat'
              : enriching
                ? company
                  ? `Creating your website for ${company}…`
                  : 'Creating your website…'
                : btfComplete
                  ? 'Company details'
                  : 'Loading more sections…'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enriching || runId ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void watchAgent()}
            >
              {conversationId ? 'Watch agent' : 'Starting agent…'}
            </Button>
          ) : null}
          {enriching || timedOut ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void ensure({ materialize: true, force: true })}
            >
              Retry prep
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost">
            <Link to={`/pi/sites/${siteId}`}>Back to site</Link>
          </Button>
        </div>
      </div>
      {timedOut && enriching ? (
        <div className="border-border/60 border-b bg-muted/40 px-4 py-2 text-muted-foreground text-xs">
          Still creating your website. Retry prep, or watch the agent in the
          side panel.
        </div>
      ) : null}
      {watchError ? (
        <div className="border-border/60 border-b bg-muted/40 px-4 py-2 text-muted-foreground text-xs">
          {watchError}
        </div>
      ) : null}
      {doc ? (
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
      ) : (
        <div className="p-6 text-muted-foreground text-sm">Loading page…</div>
      )}
    </PiFieldSurface>
  )
}
