/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

const CONTEXT_QUERY_KEY = 'context'

export interface ContextNode {
  id: string
  kind: string
  title: string | null
  uri: string | null
  summary: string | null
}

interface SearchSnippet {
  nodeId: string
  bucketId: string
  kind: string
  title: string | null
  uri: string | null
  snippet: string
  sourceKind: string
  score: number
}

interface SearchResponse {
  bucketId: string
  query: string
  mode: string
  suggestions: string[]
  snippets: SearchSnippet[]
}

interface NodeListPage {
  nodes: ContextNode[]
  hasMore: boolean
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
      const res = await agentFetch(`${base(baseUrl as string)}/context/buckets`)
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
      const res = await agentFetch(
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

export function useContextSearch(bucketId: string, query: string) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const trimmed = query.trim()
  const searchQuery = useQuery({
    queryKey: [CONTEXT_QUERY_KEY, 'search', baseUrl, bucketId, trimmed],
    queryFn: async () => {
      const params = new URLSearchParams({ bucketId, q: trimmed, limit: '20' })
      const res = await agentFetch(
        `${base(baseUrl as string)}/context/search?${params}`,
      )
      if (!res.ok) throw new Error(`Failed to search context (${res.status})`)
      return (await res.json()) as SearchResponse
    },
    enabled: Boolean(baseUrl) && !urlLoading && trimmed.length > 0,
  })
  return {
    data: searchQuery.data,
    loading: searchQuery.isLoading,
    error: searchQuery.error,
  }
}

export function useContextNodes(
  bucketId: string,
  kind: string,
  enabled: boolean,
) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const PAGE_SIZE = 20
  const query = useInfiniteQuery({
    queryKey: [CONTEXT_QUERY_KEY, 'nodes', baseUrl, bucketId, kind],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({
        bucketId,
        kind,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      })
      const res = await agentFetch(
        `${base(baseUrl as string)}/context/nodes?${params}`,
      )
      if (!res.ok) throw new Error(`Failed to load context (${res.status})`)
      return (await res.json()) as NodeListPage
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length * PAGE_SIZE : undefined,
    enabled: Boolean(baseUrl) && !urlLoading && enabled,
  })
  const nodes = query.data?.pages.flatMap((p) => p.nodes) ?? []
  return {
    nodes,
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    fetchMore: query.fetchNextPage,
    loading: query.isLoading,
  }
}

export function useDeleteContextNodes(bucketId: string) {
  const { baseUrl } = useAgentServerUrl()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (nodeIds: string[]) => {
      const res = await agentFetch(`${base(baseUrl as string)}/context/nodes`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds }),
      })
      if (!res.ok)
        throw new Error(`Failed to delete context items (${res.status})`)
      return (await res.json()) as { deleted: number }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [CONTEXT_QUERY_KEY, 'current', baseUrl, bucketId],
      })
      void queryClient.invalidateQueries({
        queryKey: [CONTEXT_QUERY_KEY, 'nodes', baseUrl, bucketId],
      })
      void queryClient.invalidateQueries({
        queryKey: [CONTEXT_QUERY_KEY, 'search', baseUrl, bucketId],
      })
    },
  })
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
      const res = await agentFetch(
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
      const res = await agentFetch(
        `${base(baseUrl as string)}/context/grants`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, bucketId }),
        },
      )
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
      const res = await agentFetch(
        `${base(baseUrl as string)}/context/settings`,
      )
      if (!res.ok)
        throw new Error(`Failed to load context settings (${res.status})`)
      return (await res.json()) as ContextSettings
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })

  const updateSettings = useMutation({
    mutationFn: async (patch: Partial<ContextSettings>) => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/context/settings`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
      )
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
