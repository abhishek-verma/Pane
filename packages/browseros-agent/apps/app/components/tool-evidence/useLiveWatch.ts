import { useEffect, useState } from 'react'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import {
  LIVE_WATCH_MIN_FRAME_INTERVAL_MS,
  replaceLiveWatchBlobUrl,
  shouldCommitLiveWatchFrame,
} from '@/lib/tool-evidence/live-watch-frame'
import { buildScreencastWsUrl } from '@/lib/tool-evidence/resolve-watch-target'

export type LiveWatchStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'detached'
  | 'error'

export interface LiveWatchState {
  status: LiveWatchStatus
  /** Object URL for the latest JPEG frame (revoked on replace/teardown). */
  blobUrl: string | null
  url?: string
  error?: string
  /** Epoch ms of the last committed frame (for sparse/background UX). */
  lastFrameAt?: number | null
}

interface ScreencastFrameMessage {
  type: 'frame'
  data: string
}

interface ScreencastStatusMessage {
  type: 'status'
  status: 'connected' | 'detached'
  windowId: number
  pageId?: number
  url?: string
}

type ScreencastMessage = ScreencastFrameMessage | ScreencastStatusMessage

async function resolveWindowId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    const windowId = tabs[0]?.windowId
    return typeof windowId === 'number' && windowId > 0 ? windowId : null
  } catch {
    return null
  }
}

/**
 * Connects to agent-server `/screencast` while `enabled`. Tears down the
 * WebSocket when disabled or on unmount. `pageId` is optional — when
 * omitted the server follows the window's active page.
 *
 * Frames are coalesced (latest-wins), rate-limited, and converted to a
 * single blob URL so high-rate JPEG streams cannot flood V8 with base64
 * strings held in React state. Does not call Page.bringToFront — agent
 * tabs may stay backgrounded; the strip surfaces a sparse-frame hint.
 */
export function useLiveWatch(
  pageId: number | undefined,
  enabled: boolean,
): LiveWatchState {
  const [state, setState] = useState<LiveWatchState>({
    status: 'idle',
    blobUrl: null,
    lastFrameAt: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState((prev) => {
        if (prev.blobUrl) URL.revokeObjectURL(prev.blobUrl)
        return { status: 'idle', blobUrl: null, lastFrameAt: null }
      })
      return
    }

    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let rafId: number | undefined
    let pendingJpeg: string | null = null
    let liveBlobUrl: string | null = null
    let lastCommitAt = 0
    let rafScheduledAt = 0

    const revokeLive = () => {
      if (liveBlobUrl) {
        URL.revokeObjectURL(liveBlobUrl)
        liveBlobUrl = null
      }
    }

    const commitBlob = (jpeg: string) => {
      if (cancelled) return
      const nextUrl = replaceLiveWatchBlobUrl(liveBlobUrl, jpeg)
      if (!nextUrl || nextUrl === liveBlobUrl) return
      liveBlobUrl = nextUrl
      lastCommitAt = Date.now()
      setState((prev) => ({
        ...prev,
        status: 'connected',
        blobUrl: nextUrl,
        lastFrameAt: lastCommitAt,
        error: undefined,
      }))
    }

    const flushFrame = () => {
      rafId = undefined
      if (cancelled || pendingJpeg == null) return
      const now = Date.now()
      const decision = shouldCommitLiveWatchFrame({
        now,
        lastCommitAt,
        rafScheduledAt,
        minIntervalMs: LIVE_WATCH_MIN_FRAME_INTERVAL_MS,
      })
      if (decision === 'drop_lag' || decision === 'wait_interval') {
        rafScheduledAt = now
        rafId = requestAnimationFrame(flushFrame)
        return
      }
      const jpeg = pendingJpeg
      pendingJpeg = null
      commitBlob(jpeg)
    }

    const scheduleFrame = (jpeg: string) => {
      pendingJpeg = jpeg
      if (rafId != null) return
      rafScheduledAt = Date.now()
      rafId = requestAnimationFrame(flushFrame)
    }

    setState((prev) => ({
      status: 'connecting',
      blobUrl: prev.blobUrl,
      url: prev.url,
      lastFrameAt: prev.lastFrameAt ?? null,
    }))

    async function connect() {
      const windowId = await resolveWindowId()
      if (cancelled) return
      if (windowId == null) {
        revokeLive()
        setState({
          status: 'error',
          blobUrl: null,
          lastFrameAt: null,
          error: 'No active window',
        })
        return
      }

      let httpBase: string
      try {
        httpBase = await getAgentServerUrl()
      } catch (err) {
        if (cancelled) return
        revokeLive()
        setState({
          status: 'error',
          blobUrl: null,
          lastFrameAt: null,
          error: err instanceof Error ? err.message : String(err),
        })
        return
      }

      if (cancelled) return

      const url = buildScreencastWsUrl(httpBase, windowId, pageId)
      ws = new WebSocket(url)

      ws.onopen = () => {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          status: 'connecting',
          error: undefined,
        }))
      }

      ws.onmessage = (event) => {
        if (cancelled) return
        let msg: ScreencastMessage
        try {
          msg = JSON.parse(String(event.data)) as ScreencastMessage
        } catch {
          return
        }
        if (msg.type === 'frame' && typeof msg.data === 'string') {
          scheduleFrame(msg.data)
          return
        }
        if (msg.type === 'status') {
          if (msg.status === 'connected') {
            setState((prev) => ({
              ...prev,
              status: 'connected',
              url: msg.url ?? prev.url,
              error: undefined,
            }))
          } else if (msg.status === 'detached') {
            setState((prev) => ({
              ...prev,
              status: 'detached',
              url: undefined,
            }))
          }
        }
      }

      ws.onerror = () => {
        if (cancelled) return
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: 'Screencast connection failed',
        }))
      }

      ws.onclose = () => {
        if (cancelled) return
        // Soft reconnect while still watching — stream end closes via
        // the enabled=false cleanup path.
        reconnectTimer = setTimeout(() => {
          if (!cancelled) void connect()
        }, 1500)
      }
    }

    void connect()

    return () => {
      cancelled = true
      if (rafId != null) cancelAnimationFrame(rafId)
      pendingJpeg = null
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.onclose = null
        ws.onerror = null
        ws.onmessage = null
        ws.close()
        ws = null
      }
      revokeLive()
    }
  }, [enabled, pageId])

  return state
}
