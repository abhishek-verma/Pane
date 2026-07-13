/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

const CONTEXT_QUERY_KEY = 'context'

export interface ContextNode {
  id: string
  kind: string
  title: string | null
  uri: string | null
  summary: string | null
}

export interface CurrentWorkResponse {
  bucketId: string
  work: {
    tabs: ContextNode[]
    pages: ContextNode[]
    files: ContextNode[]
    runs: ContextNode[]
    terminal: ContextNode[]
    research: ContextNode[]
    meetings: ContextNode[]
  }
  indexingPaused: boolean
  pauseReason: string | null
}

export interface DomainGrant {
  domain: string
  bucketId: string
  allowed: boolean
  updatedAt: number
}

export interface Bucket {
  id: string
  name: string
  kind: string
  createdAt: number
}

function base(url: string) {
  return url.replace(/\/$/, '')
}

export function useContextBuckets() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [CONTEXT_QUERY_KEY, 'buckets', baseUrl],
    queryFn: async () => {
      const res = await fetch(`${base(baseUrl as string)}/context/buckets`)
      if (!res.ok) throw new Error(`Failed to load buckets (${res.status})`)
      const body = (await res.json()) as { buckets: Bucket[] }
      return body.buckets
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })
  return {
    buckets: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useContextCurrent(bucketId: string) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [CONTEXT_QUERY_KEY, 'current', baseUrl, bucketId],
    queryFn: async () => {
      const res = await fetch(
        `${base(baseUrl as string)}/context/current?bucketId=${encodeURIComponent(bucketId)}`,
      )
      if (!res.ok) throw new Error(`Failed to load context (${res.status})`)
      return (await res.json()) as CurrentWorkResponse
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })
  return {
    data: query.data,
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useContextGrants(
  bucketId: string,
  options: { deniedOnly?: boolean } = {},
) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [
      CONTEXT_QUERY_KEY,
      'grants',
      baseUrl,
      bucketId,
      options.deniedOnly,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ bucketId })
      if (options.deniedOnly) params.set('deniedOnly', 'true')
      const res = await fetch(
        `${base(baseUrl as string)}/context/grants?${params}`,
      )
      if (!res.ok) throw new Error(`Failed to load grants (${res.status})`)
      return (await res.json()) as {
        grants: DomainGrant[]
        visitedDomains: string[]
      }
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })

  const setGrant = useMutation({
    mutationFn: async (input: { domain: string; allowed: boolean }) => {
      const res = await fetch(`${base(baseUrl as string)}/context/grants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, bucketId }),
      })
      if (!res.ok) throw new Error(`Failed to update grant (${res.status})`)
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [CONTEXT_QUERY_KEY, 'grants', baseUrl, bucketId],
      })
      void queryClient.invalidateQueries({
        queryKey: [CONTEXT_QUERY_KEY, 'current', baseUrl, bucketId],
      })
    },
  })

  return {
    grants: query.data?.grants ?? [],
    visitedDomains: query.data?.visitedDomains ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    setGrant,
    refetch: query.refetch,
  }
}

export interface ContextSettings {
  pauseOnBattery: boolean
}

export function useContextSettings() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [CONTEXT_QUERY_KEY, 'settings', baseUrl],
    queryFn: async () => {
      const res = await fetch(`${base(baseUrl as string)}/context/settings`)
      if (!res.ok)
        throw new Error(`Failed to load context settings (${res.status})`)
      return (await res.json()) as ContextSettings
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })

  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<ContextSettings>) => {
      const res = await fetch(`${base(baseUrl as string)}/context/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`Failed to update settings (${res.status})`)
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [CONTEXT_QUERY_KEY, 'settings', baseUrl],
      })
    },
  })

  return {
    settings: query.data,
    loading: query.isLoading || urlLoading,
    updateSettings,
  }
}
