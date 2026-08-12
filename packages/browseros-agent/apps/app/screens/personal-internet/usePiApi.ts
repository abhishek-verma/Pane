/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { emitPiInvalidate, subscribePiInvalidate } from '@/lib/pi-invalidate'
import type { PiPageDoc } from './types'

async function piGet<T>(path: string): Promise<T> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}${path}`)
  if (!res.ok) throw new Error(`PI API ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export function usePiInvalidateListener(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const unsub = subscribePiInvalidate(() => {
      void qc.invalidateQueries({ queryKey: ['pi'] })
      void qc.invalidateQueries({ queryKey: ['scheduler', 'home'] })
    })
    // Poll mutation cursor so agent-side pi_* tool writes refresh open PI UI
    // without requiring a full page reload (Ship Bar S6).
    let lastSeen = 0
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      try {
        const base = await getAgentServerUrl()
        const res = await agentFetch(`${base}/pi/mutation-cursor`)
        if (!res.ok) return
        const data = (await res.json()) as { lastMutationAt?: number }
        const at = data.lastMutationAt ?? 0
        if (at > 0 && lastSeen > 0 && at > lastSeen) {
          emitPiInvalidate()
        }
        if (at > lastSeen) lastSeen = at
      } catch {
        // server down
      }
    }
    void poll()
    const id = window.setInterval(() => void poll(), 3000)
    return () => {
      cancelled = true
      window.clearInterval(id)
      unsub()
    }
  }, [qc])
}

export function usePiSite(siteId: string | undefined) {
  return useQuery({
    queryKey: ['pi', 'site', siteId],
    enabled: !!siteId,
    refetchInterval: 5_000,
    queryFn: () =>
      piGet<{
        site: {
          id: string
          name: string
          status: string
          harvestEnabled?: number
        }
        pulse: {
          pulseLine: string
          lastUpdatedAt?: string
          staleAt?: string | null
          counts?: Record<string, number>
        } | null
        pages: Array<{
          id: string
          title: string
          kind: string
          entityKey?: string | null
        }>
      }>(`/pi/sites/${siteId}`),
  })
}

export function usePiPage(
  siteId: string | undefined,
  pageId: string | undefined,
) {
  return useQuery({
    queryKey: ['pi', 'page', siteId, pageId],
    enabled: !!siteId && !!pageId,
    queryFn: () =>
      piGet<{
        doc: PiPageDoc | null
        page: { id: string; title: string }
        ok?: boolean
        issues?: string[]
        fixHint?: string
        raw?: unknown
        diagnosis?: {
          agentBrief: string
          needsRaw: boolean
          findings: Array<{
            code: string
            severity: string
            summary: string
            agentSteps?: string[]
            suggestedApproach?: string
          }>
          autoFixesApplied?: string[]
        }
        contentSummary?: {
          title?: string
          nodeTypes?: string[]
          boardSummaries?: Array<{
            columns: string[]
            cardTitles: string[]
            shape: string
          }>
        }
      }>(`/pi/sites/${siteId}/pages/${pageId}`),
  })
}

export function usePiTemp(tempId: string | undefined) {
  return useQuery({
    queryKey: ['pi', 'temp', tempId],
    enabled: !!tempId,
    queryFn: () =>
      piGet<{ doc: PiPageDoc; temp: { id: string; title: string } }>(
        `/pi/temps/${tempId}`,
      ),
  })
}

export type PiLibrarySite = {
  id: string
  name: string
  status: string
  pulseLine?: string
}

export function usePiLibrary() {
  return useQuery({
    queryKey: ['pi', 'library'],
    queryFn: () => piGet<{ sites: PiLibrarySite[] }>('/pi/library'),
  })
}

/** Archived sites only — fetched separately so the default My Sites view
 * never pays for or renders them until the user asks to see history. */
export function usePiArchivedSites(enabled: boolean) {
  return useQuery({
    queryKey: ['pi', 'library', 'archived'],
    enabled,
    queryFn: () =>
      piGet<{ sites: PiLibrarySite[] }>('/pi/library?status=archived'),
  })
}

export function usePiTemplates() {
  return useQuery({
    queryKey: ['pi', 'templates'],
    staleTime: Infinity,
    queryFn: () =>
      piGet<{
        templates: Array<{ id: string; name: string; jtbd: string }>
      }>('/pi/templates'),
  })
}

export function usePiRecords(siteId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['pi', 'records', siteId],
    enabled: !!siteId && enabled,
    queryFn: () =>
      piGet<{
        records: Array<{
          id: string
          type: string
          data: Record<string, unknown>
          updatedAt: number
        }>
      }>(`/pi/sites/${siteId}/records`),
  })
}

export async function piPost(path: string, body?: unknown): Promise<Response> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.ok) emitPiInvalidate()
  return res
}

export async function piPatch(path: string, body?: unknown): Promise<Response> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.ok) emitPiInvalidate()
  return res
}

export async function piDelete(path: string): Promise<Response> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}${path}`, { method: 'DELETE' })
  if (res.ok) emitPiInvalidate()
  return res
}
