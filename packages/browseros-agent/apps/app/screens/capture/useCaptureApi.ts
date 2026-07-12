/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

const CAPTURE_QUERY_KEY = 'capture'

export type CaptureClass = 'meeting' | 'browsing' | 'research'

export interface CaptureConsent {
  domain: string
  class: CaptureClass
  bucketId: string
  allowed: boolean
  updatedAt: number
}

export interface CaptureSession {
  id: string
  bucketId: string
  kind: CaptureClass
  tabId: number | null
  url: string | null
  title: string | null
  status: 'active' | 'paused' | 'stopped' | 'error'
  provider: string
  startedAt: number
  endedAt: number | null
  transcriptPath: string | null
  summaryPath: string | null
  graphNodeId: string | null
}

export interface CaptureStatus {
  paused: boolean
  reason: 'battery' | 'disk' | 'load' | null
  diskUsageBytes: number
  activeSessions: number
}

function base(url: string) {
  return url.replace(/\/$/, '')
}

export function useCaptureStatus() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [CAPTURE_QUERY_KEY, 'status', baseUrl],
    queryFn: async () => {
      const res = await fetch(`${base(baseUrl as string)}/capture/status`)
      if (!res.ok)
        throw new Error(`Failed to load capture status (${res.status})`)
      return (await res.json()) as CaptureStatus
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })
  return { data: query.data, loading: query.isLoading || urlLoading }
}

export function useCaptureMeetings(bucketId: string) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [CAPTURE_QUERY_KEY, 'meetings', baseUrl, bucketId],
    queryFn: async () => {
      const res = await fetch(
        `${base(baseUrl as string)}/capture/meetings?bucketId=${encodeURIComponent(bucketId)}`,
      )
      if (!res.ok) throw new Error(`Failed to load meetings (${res.status})`)
      return (await res.json()) as { sessions: CaptureSession[] }
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })
  return {
    sessions: query.data?.sessions ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

export function useCaptureConsents(bucketId: string) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [CAPTURE_QUERY_KEY, 'consents', baseUrl, bucketId],
    queryFn: async () => {
      const res = await fetch(
        `${base(baseUrl as string)}/capture/consents?bucketId=${encodeURIComponent(bucketId)}`,
      )
      if (!res.ok) throw new Error(`Failed to load consents (${res.status})`)
      return (await res.json()) as { consents: CaptureConsent[] }
    },
    enabled: Boolean(baseUrl) && !urlLoading,
  })

  const setConsent = useMutation({
    mutationFn: async (input: {
      domain: string
      class: CaptureClass
      allowed: boolean
      bucketId?: string
    }) => {
      const res = await fetch(`${base(baseUrl as string)}/capture/consents`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          bucketId: input.bucketId ?? bucketId,
        }),
      })
      if (!res.ok) throw new Error(`Failed to update consent (${res.status})`)
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [CAPTURE_QUERY_KEY, 'consents', baseUrl, bucketId],
      })
    },
  })

  return {
    consents: query.data?.consents ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    setConsent,
  }
}

export interface TranscriptSegment {
  id: string
  sessionId: string
  kind: 'partial' | 'final'
  text: string
  capturedAt: number
}

export function useCaptureTranscript(sessionId: string | null) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [CAPTURE_QUERY_KEY, 'transcript', baseUrl, sessionId],
    queryFn: async () => {
      const res = await fetch(
        `${base(baseUrl as string)}/capture/meetings/${encodeURIComponent(sessionId as string)}/transcript`,
      )
      if (!res.ok) throw new Error(`Failed to load transcript (${res.status})`)
      return (await res.json()) as { segments: TranscriptSegment[] }
    },
    enabled: Boolean(baseUrl) && !urlLoading && Boolean(sessionId),
  })
  return {
    segments: query.data?.segments ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
  }
}
