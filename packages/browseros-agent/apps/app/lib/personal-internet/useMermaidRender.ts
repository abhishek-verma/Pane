/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Shared by ChatMermaidBlock and PiMermaidView — both render the same
 * sandboxed-broker source and need identical retry semantics; keeping this
 * in one hook is what stops them drifting out of sync with each other (the
 * same reasoning MERMAID_RENDERER_PLUGINS being a single constant follows).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { PI_MERMAID_RENDER_ENABLED } from './mermaid-render-enabled'
import { renderMermaidInSandbox } from './mermaid-sandbox-broker'

export type MermaidRenderState = {
  svg: string | null
  error: string | null
  /** Whether Retry can plausibly succeed — see MermaidBrokerResult. */
  retryable: boolean
  retry: () => void
}

export function useMermaidRender(source: string): MermaidRenderState {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const runRender = useCallback(
    async (signal: AbortSignal) => {
      setSvg(null)
      setError(null)
      setRetryable(false)
      if (!source.trim()) {
        setError('Missing diagram source')
        return
      }
      if (!PI_MERMAID_RENDER_ENABLED) {
        setError('Diagram rendering disabled')
        return
      }
      const result = await renderMermaidInSandbox(source, { signal })
      if (signal.aborted) return
      if (result.ok) {
        setSvg(result.svg)
        return
      }
      if (result.error === 'cancelled') return
      setError(result.error)
      setRetryable(result.retryable)
    },
    [source],
  )

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    void runRender(controller.signal)
    // Abort whatever is CURRENTLY active, not this closure's `controller` —
    // retry() can swap controllerRef to a newer one after this effect ran,
    // and cleanup must cancel that one, not this now-stale reference.
    return () => controllerRef.current?.abort()
  }, [runRender])

  const retry = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    void runRender(controller.signal)
  }, [runRender])

  return { svg, error, retryable, retry }
}
