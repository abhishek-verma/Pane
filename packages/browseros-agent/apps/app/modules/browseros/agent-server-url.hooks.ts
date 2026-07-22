import { useEffect, useState } from 'react'
import { getAgentServerUrl } from '../../lib/browseros/helpers'

const INITIAL_RETRY_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 8_000
const HEALTH_TIMEOUT_MS = 2_000
/** After this many failed attempts, surface an error while background retries continue. */
const ERROR_AFTER_ATTEMPTS = 3

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
 * After a few failures, surfaces an error for UI while retries continue.
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
    let attempts = 0

    function scheduleRetry() {
      retryTimer = setTimeout(() => {
        delayMs = Math.min(delayMs * 2, MAX_RETRY_DELAY_MS)
        void loadUrl()
      }, delayMs)
    }

    let errorSurfaced = false
    function surfaceError(error: Error) {
      // Keep retrying in the background; only flip to error once so we do not
      // thrash consumers on every attempt.
      if (errorSurfaced) return
      errorSurfaced = true
      setState({ isLoading: false, error })
    }

    async function loadUrl() {
      attempts += 1
      try {
        const url = await getAgentServerUrl()
        const healthy = await waitForAgentHealth(url)
        if (cancelled) return
        if (!healthy) {
          if (attempts >= ERROR_AFTER_ATTEMPTS) {
            surfaceError(
              new Error('Pane agent server is not healthy yet. Retrying…'),
            )
          }
          scheduleRetry()
          return
        }
        setState({ baseUrl: url, isLoading: false, error: null })
      } catch (e) {
        if (cancelled) return
        const error = e instanceof Error ? e : new Error(String(e))
        if (attempts >= ERROR_AFTER_ATTEMPTS) {
          surfaceError(error)
        }
        scheduleRetry()
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
