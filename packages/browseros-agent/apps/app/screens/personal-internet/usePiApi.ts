/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQuery } from '@tanstack/react-query'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import type { PiPageDoc } from './types'

async function piGet<T>(path: string): Promise<T> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}${path}`)
  if (!res.ok) throw new Error(`PI API ${path} failed: ${res.status}`)
  return res.json() as Promise<T>
}

export function usePiSite(siteId: string | undefined) {
  return useQuery({
    queryKey: ['pi', 'site', siteId],
    enabled: !!siteId,
    queryFn: () =>
      piGet<{
        site: { id: string; name: string; status: string }
        pulse: { pulseLine: string } | null
        pages: Array<{ id: string; title: string; kind: string }>
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
      piGet<{ doc: PiPageDoc; page: { id: string; title: string } }>(
        `/pi/sites/${siteId}/pages/${pageId}`,
      ),
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

export function usePiLibrary() {
  return useQuery({
    queryKey: ['pi', 'library'],
    queryFn: () =>
      piGet<{
        sites: Array<{
          id: string
          name: string
          status: string
          pulseLine?: string
        }>
      }>('/pi/library'),
  })
}

export async function piPost(path: string, body?: unknown): Promise<Response> {
  const base = await getAgentServerUrl()
  return agentFetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function piDelete(path: string): Promise<Response> {
  const base = await getAgentServerUrl()
  return agentFetch(`${base}${path}`, { method: 'DELETE' })
}
