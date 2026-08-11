/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Queued Mermaid renders via a disposable Manifest V3 sandbox iframe.
 * One render at a time; iframe is destroyed after each result or timeout so a
 * sandbox OOM cannot kill the privileged extension renderer. A failure
 * during iframe boot (before the sandbox's 'ready' handshake — a timeout or
 * the iframe's own load-error event) gets one retry with a fresh iframe —
 * see renderWithRetry — since that phase is prone to transient CPU
 * contention rather than a defect in a specific diagram. The retry is
 * skipped when other renders are already queued behind this one, so one
 * flaky diagram can't roughly double the wait for everything after it.
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
  | { ok: false; error: string; retryable: boolean }

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
      resolve({ ok: false, error: 'cancelled', retryable: false })
      return
    }
    try {
      assertMermaidSourceBudget(source)
    } catch (e) {
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : 'invalid mermaid source',
        retryable: false,
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
        item.resolve({ ok: false, error: 'cancelled', retryable: false })
        continue
      }
      // Drop superseded requests when many are queued for the same UI slot:
      // callers abort via signal; we still process FIFO for distinct requests.
      const result = await renderWithRetry(
        item.source,
        item.timeoutMs,
        item.signal,
      )
      if (item.signal?.aborted) {
        item.resolve({ ok: false, error: 'cancelled', retryable: false })
      } else {
        item.resolve(result)
      }
    }
  } finally {
    draining = false
    if (queue.length) void drainQueue()
  }
}

/**
 * At most one retry, and only when the failure is `retryable` — a boot
 * failure (timeout before 'ready', or the iframe's own load-error event),
 * which is most likely transient CPU/resource contention rather than a
 * defect in this specific diagram. A non-retryable failure (a timed-out
 * render that already reached the sandbox, a parse error, a budget
 * overage) would very likely fail identically again, so retrying it would
 * just double the wait for no real chance of success.
 *
 * The queue-depth check below is deliberately read AFTER runOneRender
 * resolves, not before it starts. Sibling diagrams that mount in the same
 * render batch (a page with several ```mermaid fences) enqueue their own
 * requests via their own effects, which run in the same synchronous pass
 * but strictly after this function has already been called for the first
 * one — so `queue.length` at call time is almost always still 0 for
 * whichever request happens to be dequeued first, making an up-front check
 * useless for exactly the multi-diagram case this exists to protect.
 * Checking after the (multi-second) first attempt has completed reflects
 * real contention: by then, every sibling that was going to enqueue has
 * had ample time to do so.
 */
async function renderWithRetry(
  source: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<MermaidBrokerResult> {
  const result = await runOneRender(source, timeoutMs, signal)
  if (signal?.aborted || result.ok || !result.retryable || queue.length > 0) {
    return result
  }
  return runOneRender(source, timeoutMs, signal)
}

function runOneRender(
  source: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<MermaidBrokerResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ ok: false, error: 'no document', retryable: false })
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

    const onAbort = () =>
      finish({ ok: false, error: 'cancelled', retryable: false })

    const timer = setTimeout(() => {
      finish(
        ready
          ? {
              ok: false,
              error: 'mermaid render timed out',
              retryable: false,
            }
          : {
              ok: false,
              error: 'mermaid sandbox boot timed out',
              retryable: true,
            },
      )
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
          finish({
            ok: false,
            error: 'mermaid svg exceeds budget',
            retryable: false,
          })
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
        retryable: false,
      })
    }

    window.addEventListener('message', onMessage)
    signal?.addEventListener('abort', onAbort, { once: true })
    document.documentElement.appendChild(iframe)

    iframe.addEventListener('error', () => {
      // The iframe never loaded far enough to run any script, let alone
      // reach 'ready' — same boot-phase failure class as the pre-ready
      // timeout above, so it gets the same one-shot retry.
      finish({
        ok: false,
        error: 'failed to load mermaid sandbox',
        retryable: true,
      })
    })
  })
}
