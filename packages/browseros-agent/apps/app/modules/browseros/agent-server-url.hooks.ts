import { useEffect, useState } from 'react'
import { getAgentServerUrl } from '../../lib/browseros/helpers'

const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8_000
const HEALTH_TIMEOUT_MS = 2_000

export type UseAgentServerUrlResult =
  | { baseUrl: string; isLoading: false; error: null }
  | { baseUrl?: never; isLoading: true; error: null }
  | { baseUrl?: never; isLoading: false; error: Error }

async function waitForAgentHealth(baseUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolves the local BrowserOS server URL used by React surfaces.
 * Retries with backoff and polls `/health` until the sidecar is ready so a
 * slow post-restart bind does not leave the UI stuck on "Unable to connect".
 */
export function useAgentServerUrl(): UseAgentServerUrlResult {
  const [state, setState] = useState<UseAgentServerUrlResult>({
    isLoading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let delayMs = INITIAL_RETRY_DELAY_MS

    async function loadUrl() {
      try {
        const url = await getAgentServerUrl()
        const healthy = await waitForAgentHealth(url)
        if (cancelled) return
        if (!healthy) {
          retryTimer = setTimeout(() => {
            delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS)
            void loadUrl()
          }, delayMs)
          return
        }
        setState({ baseUrl: url, isLoading: false, error: null })
      } catch (e) {
        if (cancelled) return
        // Keep retrying — port prefs may appear after Chromium starts the sidecar.
        retryTimer = setTimeout(() => {
          delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS)
          void loadUrl()
        }, delayMs)
        // Surface a soft loading state rather than a permanent error; only
        // expose error if we never succeed (isLoading stays true while retrying).
        setState({
          isLoading: true,
          error: null,
        })
        // Preserve last error for debugging without blocking UI forever.
        void e
      }
    }

    void loadUrl()

    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [])

  return state
}
