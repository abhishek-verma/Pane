/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

const MEMORY_QUERY_KEY = 'memory'

function base(url: string) {
  return url.replace(/\/$/, '')
}

export function useMemoryFiles() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: [MEMORY_QUERY_KEY, 'files', baseUrl],
    enabled: Boolean(baseUrl) && !urlLoading,
    queryFn: async () => {
      const res = await agentFetch(`${base(baseUrl as string)}/memory/files`)
      if (!res.ok)
        throw new Error(`Failed to load memory files (${res.status})`)
      return (await res.json()) as {
        files: { soul: string; user: string; memory: string }
      }
    },
  })

  const save = useMutation({
    mutationFn: async (input: {
      which: 'soul' | 'user' | 'memory'
      content: string
    }) => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/files/${input.which}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: input.content }),
        },
      )
      if (!res.ok) throw new Error(`Failed to save ${input.which}`)
      return res.json()
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [MEMORY_QUERY_KEY] })
    },
  })

  return { ...query, save }
}

export function useStagedSkills() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: [MEMORY_QUERY_KEY, 'staged', baseUrl],
    enabled: Boolean(baseUrl) && !urlLoading,
    queryFn: async () => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/skills/staged`,
      )
      if (!res.ok)
        throw new Error(`Failed to load staged skills (${res.status})`)
      return (await res.json()) as {
        staged: Array<{ id: string; body: string | null }>
      }
    },
  })

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/skills/staged/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        },
      )
      if (!res.ok) throw new Error('Approve failed')
      return res.json()
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [MEMORY_QUERY_KEY] })
    },
  })

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/skills/staged/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        },
      )
      if (!res.ok) throw new Error('Reject failed')
      return res.json()
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [MEMORY_QUERY_KEY] })
    },
  })

  return { ...query, approve, reject }
}

export function useMemorySkills() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: [MEMORY_QUERY_KEY, 'skills', baseUrl],
    enabled: Boolean(baseUrl) && !urlLoading,
    queryFn: async () => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/skills?status=active,staged,flagged,archived`,
      )
      if (!res.ok) throw new Error(`Failed to load skills (${res.status})`)
      return (await res.json()) as {
        skills: Array<{
          id: string
          name: string
          description: string
          status: string
          uses: number
        }>
      }
    },
  })

  const importPath = useMutation({
    mutationFn: async (source: string) => {
      const payload =
        source.startsWith('https://') || source.startsWith('http://')
          ? { url: source }
          : { path: source }
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/skills/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) throw new Error('Import failed')
      return (await res.json()) as { id: string }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [MEMORY_QUERY_KEY] })
    },
  })

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/skills/${id}/archive`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error('Archive failed')
      return res.json()
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [MEMORY_QUERY_KEY] })
    },
  })

  return { ...query, importPath, archive }
}

export function usePersonas() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: [MEMORY_QUERY_KEY, 'personas', baseUrl],
    enabled: Boolean(baseUrl) && !urlLoading,
    queryFn: async () => {
      const res = await agentFetch(`${base(baseUrl as string)}/memory/personas`)
      if (!res.ok) throw new Error(`Failed to load personas (${res.status})`)
      return (await res.json()) as {
        personas: Array<{ id: string; label: string }>
        map: { bucketPersonas: Record<string, string>; pinned: string | null }
      }
    },
  })

  const apply = useMutation({
    mutationFn: async (personaId: string) => {
      const res = await agentFetch(
        `${base(baseUrl as string)}/memory/personas/apply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personaId, bucketId: 'default' }),
        },
      )
      if (!res.ok) throw new Error('Apply persona failed')
      return res.json()
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [MEMORY_QUERY_KEY] })
    },
  })

  return { ...query, apply }
}
