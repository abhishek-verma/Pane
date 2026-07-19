import { useEffect, useState } from 'react'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { buildScreencastWsUrl } from '@/lib/tool-evidence/resolve-watch-target'

export type LiveWatchStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'detached'
  | 'error'

export interface LiveWatchState {
  status: LiveWatchStatus
  /** JPEG base64 (no data: prefix) */
  jpegBase64: string | null
  url?: string
  error?: string
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
 * Frame updates are coalesced to one React state write per animation frame
 * (latest-wins) so high-rate JPEG streams cannot flood the renderer.
 */
export function useLiveWatch(
  pageId: number | undefined,
  enabled: boolean,
): LiveWatchState {
  const [state, setState] = useState<LiveWatchState>({
    status: 'idle',
    jpegBase64: null,
  })

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', jpegBase64: null })
      return
    }

    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let rafId: number | undefined
    let pendingJpeg: string | null = null

    const flushFrame = () => {
      rafId = undefined
      if (cancelled || pendingJpeg == null) return
      const jpeg = pendingJpeg
      pendingJpeg = null
      setState((prev) => ({
        ...prev,
        status: 'connected',
        jpegBase64: jpeg,
        error: undefined,
      }))
    }

    const scheduleFrame = (jpeg: string) => {
      pendingJpeg = jpeg
      if (rafId != null) return
      rafId = requestAnimationFrame(flushFrame)
    }

    setState((prev) => ({
      status: 'connecting',
      jpegBase64: prev.jpegBase64,
      url: prev.url,
    }))

    async function connect() {
      const windowId = await resolveWindowId()
      if (cancelled) return
      if (windowId == null) {
        setState({
          status: 'error',
          jpegBase64: null,
          error: 'No active window',
        })
        return
      }

      let httpBase: string
      try {
        httpBase = await getAgentServerUrl()
      } catch (err) {
        if (cancelled) return
        setState({
          status: 'error',
          jpegBase64: null,
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
    }
  }, [enabled, pageId])

  return state
}
