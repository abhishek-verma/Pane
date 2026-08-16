/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { readSseFrames } from '@/lib/sse/read-sse-frames'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

const CAPTURE_QUERY_KEY = 'capture'
const CAPTURE_FETCH_TIMEOUT_MS = 8_000

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
  status: 'active' | 'interrupted' | 'paused' | 'stopped' | 'error'
  provider: string
  startedAt: number
  endedAt: number | null
  transcriptPath: string | null
  summaryPath: string | null
  graphNodeId: string | null
  site?: string | null
  roomKey?: string | null
}

export interface CaptureStatus {
  paused: boolean
  reason: 'battery' | 'disk' | 'load' | null
  refuseNewSessions?: boolean
  asrDeferred?: boolean
  diskUsageBytes: number
  activeSessions: number
}

function base(url: string) {
  return url.replace(/\/$/, '')
}

async function captureFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return agentFetch(url, {
    ...init,
    signal: AbortSignal.timeout(CAPTURE_FETCH_TIMEOUT_MS),
  })
}

export function useCaptureStatus() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [CAPTURE_QUERY_KEY, 'status', baseUrl],
    queryFn: async () => {
      const res = await captureFetch(
        `${base(baseUrl as string)}/capture/status`,
      )
      if (!res.ok)
        throw new Error(`Failed to load capture status (${res.status})`)
      return (await res.json()) as CaptureStatus
    },
    enabled: Boolean(baseUrl) && !urlLoading,
    retry: 1,
  })
  return { data: query.data, loading: query.isLoading || urlLoading }
}

export function useCaptureMeetings(bucketId: string) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [CAPTURE_QUERY_KEY, 'meetings', baseUrl, bucketId],
    queryFn: async () => {
      const res = await captureFetch(
        `${base(baseUrl as string)}/capture/meetings?bucketId=${encodeURIComponent(bucketId)}`,
      )
      if (!res.ok) throw new Error(`Failed to load meetings (${res.status})`)
      return (await res.json()) as { sessions: CaptureSession[] }
    },
    enabled: Boolean(baseUrl) && !urlLoading,
    retry: 1,
    // Keep list status fresh so leave/tab-close clears "live" without Refresh.
    refetchInterval: (q) => {
      const sessions = q.state.data?.sessions ?? []
      const hot = sessions.some(
        (s) => s.status === 'active' || s.status === 'interrupted',
      )
      return hot ? 3_000 : false
    },
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
      const res = await captureFetch(
        `${base(baseUrl as string)}/capture/consents?bucketId=${encodeURIComponent(bucketId)}`,
      )
      if (!res.ok) throw new Error(`Failed to load consents (${res.status})`)
      return (await res.json()) as { consents: CaptureConsent[] }
    },
    enabled: Boolean(baseUrl) && !urlLoading,
    retry: 1,
  })

  const setConsent = useMutation({
    mutationFn: async (input: {
      domain: string
      class: CaptureClass
      allowed: boolean
      bucketId?: string
    }) => {
      const res = await captureFetch(
        `${base(baseUrl as string)}/capture/consents`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...input,
            bucketId: input.bucketId ?? bucketId,
          }),
        },
      )
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
  kind: 'partial' | 'final' | 'gap'
  text?: string
  capturedAt: number
  speaker?: string
  confidence?: number
  reason?: string
}

export function useCaptureTranscript(
  sessionId: string | null,
  isActive = false,
) {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const queryClient = useQueryClient()
  const [sseAlive, setSseAlive] = useState(false)

  const query = useQuery({
    queryKey: [CAPTURE_QUERY_KEY, 'transcript', baseUrl, sessionId],
    queryFn: async () => {
      const res = await captureFetch(
        `${base(baseUrl as string)}/capture/meetings/${encodeURIComponent(sessionId as string)}/transcript`,
      )
      if (!res.ok) throw new Error(`Failed to load transcript (${res.status})`)
      return (await res.json()) as { segments: TranscriptSegment[] }
    },
    enabled: Boolean(baseUrl) && !urlLoading && Boolean(sessionId),
    refetchInterval: isActive && !sseAlive ? 3_000 : isActive ? 8_000 : false,
    retry: 1,
  })

  useEffect(() => {
    if (!baseUrl || !sessionId || !isActive) return
    const url = `${base(baseUrl)}/capture/meetings/${encodeURIComponent(sessionId)}/events`
    const controller = new AbortController()
    let lastMsg = Date.now()
    const onAny = () => {
      lastMsg = Date.now()
      setSseAlive(true)
    }
    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: [CAPTURE_QUERY_KEY, 'transcript', baseUrl, sessionId],
      })
    }

    // agentFetch, not EventSource: this route requires
    // X-BrowserOS-Profile-Id, and EventSource cannot attach custom headers
    // (same bug class as the ASR model download above).
    void (async () => {
      try {
        const res = await agentFetch(url, { signal: controller.signal })
        if (!res.ok || !res.body) return
        for await (const frame of readSseFrames(res.body)) {
          switch (frame.event) {
            case 'segment':
            case 'gap':
              onAny()
              invalidate()
              break
            case 'status':
              onAny()
              void queryClient.invalidateQueries({
                queryKey: [CAPTURE_QUERY_KEY, 'meetings'],
              })
              break
            case 'heartbeat':
              onAny()
              break
          }
        }
      } catch {
        if (!controller.signal.aborted) setSseAlive(false)
      }
    })()

    const watchdog = setInterval(() => {
      if (Date.now() - lastMsg > 8_000) setSseAlive(false)
    }, 2_000)
    return () => {
      clearInterval(watchdog)
      controller.abort()
      setSseAlive(false)
    }
  }, [baseUrl, sessionId, isActive, queryClient])

  return {
    segments: query.data?.segments ?? [],
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
    live: sseAlive,
  }
}

export function useDeleteMeeting() {
  const { baseUrl } = useAgentServerUrl()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await captureFetch(
        `${base(baseUrl as string)}/capture/meetings/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(`Failed to delete meeting (${res.status})`)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [CAPTURE_QUERY_KEY] })
    },
  })
}

// ---------------------------------------------------------------------------
// ASR model status + download
// ---------------------------------------------------------------------------

export type AsrModelStatusKind = 'ready' | 'not_downloaded' | 'loading'

export interface AsrModelInfo {
  modelName: string
  status: 'ready' | 'not_downloaded'
  modelPath: string
  fileSizeBytes?: number
}

export interface AsrDownloadState {
  inProgress: boolean
  percent: number
  error: string | null
}

const ASR_MODEL_KEY = [CAPTURE_QUERY_KEY, 'asr-model-status']

interface AsrProgressEvent {
  percent?: number
  done?: boolean
  error?: string
}

/** Opens the model-download stream, throwing a descriptive error on non-2xx. */
async function fetchAsrDownloadStream(
  baseUrl: string,
  signal: AbortSignal,
): Promise<Response> {
  const res = await agentFetch(`${base(baseUrl)}/capture/asr/ensure-model`, {
    signal,
  })
  if (!res.ok || !res.body) {
    const body = await res
      .clone()
      .json()
      .catch(() => null)
    const message =
      (body as { error?: string } | null)?.error ??
      (await res.text().catch(() => ''))
    throw new Error(message || `Failed to start model download (${res.status})`)
  }
  return res
}

/** Parses a `text/event-stream` body into individual JSON payloads. */
async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AsrProgressEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })

    let sepIndex = buffer.indexOf('\n\n')
    while (sepIndex !== -1) {
      const rawEvent = buffer.slice(0, sepIndex)
      buffer = buffer.slice(sepIndex + 2)
      sepIndex = buffer.indexOf('\n\n')

      const dataLine = rawEvent
        .split('\n')
        .find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      try {
        yield JSON.parse(dataLine.slice(5).trim()) as AsrProgressEvent
      } catch {
        // ignore malformed event
      }
    }
  }
}

/**
 * Checks whether the local Whisper model is already downloaded.
 * Polls every 30 s so the UI reflects a completed download even if triggered
 * from another surface.
 */
export function useAsrModelStatus() {
  const { baseUrl, isLoading: urlLoading } = useAgentServerUrl()
  const query = useQuery({
    queryKey: [...ASR_MODEL_KEY, baseUrl],
    queryFn: async () => {
      const res = await captureFetch(
        `${base(baseUrl as string)}/capture/asr/model-status`,
      )
      if (!res.ok)
        throw new Error(`Failed to check ASR model status (${res.status})`)
      return (await res.json()) as AsrModelInfo
    },
    enabled: Boolean(baseUrl) && !urlLoading,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
  return {
    modelInfo: query.data ?? null,
    isReady: query.data?.status === 'ready',
    loading: query.isLoading || urlLoading,
    error: query.error,
    refetch: query.refetch,
  }
}

/**
 * Streams the ASR model download via SSE, updating local state with progress.
 * Call `start()` to begin; `state.percent` updates as bytes arrive.
 *
 * Uses `agentFetch` + manual SSE parsing rather than `EventSource`: this
 * route is behind the `X-BrowserOS-Profile-Id` profile-required middleware,
 * and `EventSource` cannot attach custom headers, so it always got a 400
 * before the handler ever ran. `captureFetch` isn't used here either — its
 * 8s timeout is meant for quick requests, not a multi-hundred-MB download.
 */
export function useEnsureAsrModel() {
  const { baseUrl } = useAgentServerUrl()
  const queryClient = useQueryClient()
  const [state, setState] = useState<AsrDownloadState>({
    inProgress: false,
    percent: 0,
    error: null,
  })
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(() => {
    if (!baseUrl || state.inProgress) return
    setState({ inProgress: true, percent: 0, error: null })

    const controller = new AbortController()
    abortRef.current = controller

    void (async () => {
      try {
        const res = await fetchAsrDownloadStream(baseUrl, controller.signal)
        let settled = false

        for await (const data of readSseEvents(
          res.body as ReadableStream<Uint8Array>,
        )) {
          if (data.error) {
            setState({ inProgress: false, percent: 0, error: data.error })
            settled = true
            break
          }
          const pct = data.percent ?? 0
          if (data.done === true || pct >= 100) {
            setState({ inProgress: false, percent: 100, error: null })
            settled = true
            void queryClient.invalidateQueries({ queryKey: ASR_MODEL_KEY })
            break
          }
          setState({ inProgress: true, percent: pct, error: null })
        }

        if (!settled) {
          setState((s) =>
            s.percent >= 100
              ? s
              : {
                  inProgress: false,
                  percent: s.percent,
                  error: 'Download interrupted. Please try again.',
                },
          )
        }
      } catch (err) {
        if (controller.signal.aborted) return
        setState((s) => ({
          inProgress: false,
          percent: s.percent,
          error:
            err instanceof Error
              ? err.message
              : 'Download interrupted. Please try again.',
        }))
      }
    })()
  }, [baseUrl, state.inProgress, queryClient])

  return { start, state }
}
