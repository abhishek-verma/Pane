/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Queued Mermaid renders via a disposable Manifest V3 sandbox iframe.
 * One render at a time; iframe is destroyed after each result or timeout so a
 * sandbox OOM cannot kill the privileged extension renderer. A timeout
 * during iframe boot (before the sandbox's 'ready' handshake) gets one
 * retry with a fresh iframe — see drainQueue — since that phase is prone to
 * transient CPU contention rather than a defect in a specific diagram.
 */

import { PI_LIMITS } from '@browseros/shared/constants/limits'
import { assertMermaidSourceBudget } from './mermaid-limits'
import {
  isMermaidRenderResponse,
  isMermaidSandboxReady,
  MERMAID_PROTOCOL_VERSION,
  type MermaidRenderRequest,
  sandboxPageUrl,
} from './mermaid-protocol'

export type MermaidBrokerResult =
  | { ok: true; svg: string }
  | { ok: false; error: string }

type QueueItem = {
  source: string
  resolve: (result: MermaidBrokerResult) => void
  signal?: AbortSignal
  timeoutMs: number
}

let queue: QueueItem[] = []
let draining = false

/** Test seam: reset queue between unit tests. */
export function __resetMermaidBrokerForTests(): void {
  queue = []
  draining = false
}

export function renderMermaidInSandbox(
  source: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<MermaidBrokerResult> {
  return new Promise((resolve) => {
    if (opts.signal?.aborted) {
      resolve({ ok: false, error: 'cancelled' })
      return
    }
    try {
      assertMermaidSourceBudget(source)
    } catch (e) {
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : 'invalid mermaid source',
      })
      return
    }
    queue.push({
      source,
      resolve,
      signal: opts.signal,
      timeoutMs: opts.timeoutMs ?? PI_LIMITS.MERMAID_RENDER_TIMEOUT_MS,
    })
    void drainQueue()
  })
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length) {
      const item = queue.shift()
      if (!item) break
      if (item.signal?.aborted) {
        item.resolve({ ok: false, error: 'cancelled' })
        continue
      }
      // Drop superseded requests when many are queued for the same UI slot:
      // callers abort via signal; we still process FIFO for distinct requests.
      let result = await runOneRender(item.source, item.timeoutMs, item.signal)
      // A timeout that fires before the sandbox iframe ever finished
      // booting (no 'ready' handshake received) is most likely transient —
      // a cold iframe paying full JS parse/init cost under momentary CPU
      // contention, not a problem with this specific diagram. A fresh
      // iframe costs nothing beyond the retry itself, so it's worth one
      // more try. A timeout AFTER boot (the render request was actually
      // sent and mermaid itself is what's hanging) is NOT retried — the
      // identical source would very likely hang identically again, so a
      // retry there would just double the wait for no real chance of
      // success.
      if (
        !item.signal?.aborted &&
        !result.ok &&
        result.error === 'mermaid sandbox boot timed out'
      ) {
        result = await runOneRender(item.source, item.timeoutMs, item.signal)
      }
      if (item.signal?.aborted) {
        item.resolve({ ok: false, error: 'cancelled' })
      } else {
        item.resolve(result)
      }
    }
  } finally {
    draining = false
    if (queue.length) void drainQueue()
  }
}

function runOneRender(
  source: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MermaidBrokerResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ ok: false, error: 'no document' })
      return
    }

    const requestId = `mmd-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.style.cssText =
      'position:absolute;width:0;height:0;border:0;visibility:hidden'
    iframe.src = sandboxPageUrl()

    let settled = false
    let ready = false

    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      iframe.remove()
    }

    const finish = (result: MermaidBrokerResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const onAbort = () => finish({ ok: false, error: 'cancelled' })

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: ready
          ? 'mermaid render timed out'
          : 'mermaid sandbox boot timed out',
      })
    }, timeoutMs)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      if (isMermaidSandboxReady(event.data)) {
        if (ready || settled) return
        ready = true
        const req: MermaidRenderRequest = {
          type: 'pane-mermaid-render',
          version: MERMAID_PROTOCOL_VERSION,
          requestId,
          source,
        }
        iframe.contentWindow?.postMessage(req, '*')
        return
      }
      if (!isMermaidRenderResponse(event.data)) return
      if (event.data.requestId !== requestId) return
      if (event.data.ok) {
        if (
          typeof event.data.svg !== 'string' ||
          event.data.svg.length > PI_LIMITS.MAX_MERMAID_SVG_CHARS
        ) {
          finish({ ok: false, error: 'mermaid svg exceeds budget' })
          return
        }
        finish({ ok: true, svg: event.data.svg })
        return
      }
      finish({
        ok: false,
        error:
          typeof event.data.error === 'string'
            ? event.data.error
            : 'mermaid render failed',
      })
    }

    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    document.documentElement.appendChild(iframe)

    iframe.addEventListener('error', () => {
      finish({ ok: false, error: 'failed to load mermaid sandbox' })
    })
  })
}
