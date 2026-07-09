/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

const TASKS_QUERY_KEY = 'tasks'

export interface Task {
  id: string
  bucketId: string
  title: string
  status: 'inbox' | 'triaged' | 'done' | 'cancelled'
  notes: string | null
  createdAt: number
  updatedAt: number
  scheduledJobId: string | null
  nodeIds?: string[]
}

function base(url: string) {
  return url.replace(/\/$/, '')
}

export function useTasks(bucketId = 'default', status?: string) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: [TASKS_QUERY_KEY, baseUrl, bucketId, status],
    queryFn: async () => {
      const params = new URLSearchParams({ bucketId })
      if (status) params.set('status', status)
      const res = await fetch(
        `${base(baseUrl as string)}/tasks?${params.toString()}`,
      )
      if (!res.ok) throw new Error(`Failed to load tasks (${res.status})`)
      const body = (await res.json()) as { tasks: Task[] }
      return body.tasks
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: [TASKS_QUERY_KEY] })

  const create = useMutation({
    mutationFn: async (input: { title: string; notes?: string }) => {
      const res = await fetch(`${base(baseUrl as string)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, bucketId }),
      })
      if (!res.ok) throw new Error(`Failed to create task (${res.status})`)
      return res.json()
    },
    onSuccess: invalidate,
  })

  const patch = useMutation({
    mutationFn: async (input: {
      id: string
      status?: Task['status']
      title?: string
      notes?: string | null
      scheduledJobId?: string | null
    }) => {
      const { id, ...body } = input
      const res = await fetch(`${base(baseUrl as string)}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`Failed to update task (${res.status})`)
      return res.json()
    },
    onSuccess: invalidate,
  })

  return {
    tasks: query.data ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
    create,
    patch,
  }
}
