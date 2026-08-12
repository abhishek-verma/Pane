/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Queued Shiki highlighting via a persistent Manifest V3 sandbox iframe.
 * Unlike mermaid-sandbox-broker.ts (fresh iframe per render — a bad diagram
 * is the common failure mode worth isolating per attempt), this sandbox is
 * reused across calls: grammar/theme loading is the expensive part of
 * highlighting, not each individual call, so tearing it down every time
 * would defeat the point of moving this work off the main thread at all.
 * If a request ever times out, the sandbox is assumed stuck and recycled —
 * the next request gets a fresh instance rather than queueing behind one
 * that will never respond.
 *
 * Two request kinds share the same sandbox + singleton highlighter:
 * `highlightInSandbox` (tokens, for Streamdown's `plugins.code`) and
 * `highlightHtmlInSandbox` (rendered HTML, for CodeBlock's standalone use —
 * tool-call input/output display, which doesn't go through Streamdown).
 */

import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import type { BundledLanguage, ThemeInput } from 'streamdown'
import {
  isShikiHighlightHtmlResponse,
  isShikiHighlightResponse,
  isShikiSandboxReady,
  SHIKI_PROTOCOL_VERSION,
  type ShikiHighlightHtmlRequest,
  type ShikiHighlightHtmlResponse,
  type ShikiHighlightPayload,
  type ShikiHighlightRequest,
  type ShikiHighlightResponse,
  shikiSandboxPageUrl,
} from './shiki-protocol'

export type ShikiBrokerResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; retryable: boolean }

type QueueTask = () => Promise<void>

let queue: QueueTask[] = []
let draining = false

let sandboxIframe: HTMLIFrameElement | null = null
let sandboxReady: Promise<Window> | null = null

/** Test seam: reset broker + sandbox state between unit tests. */
export function __resetShikiBrokerForTests(): void {
  queue = []
  draining = false
  sandboxIframe?.remove()
  sandboxIframe = null
  sandboxReady = null
}

export function highlightInSandbox(
  code: string,
  language: BundledLanguage,
  themes: [ThemeInput, ThemeInput],
  opts: { timeoutMs?: number } = {},
): Promise<ShikiBrokerResult<ShikiHighlightPayload>> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.SHIKI_HIGHLIGHT
  return new Promise((resolve) => {
    enqueue(async () => {
      const call = await callWithRetry(() =>
        callSandbox<ShikiHighlightRequest, ShikiHighlightResponse>(
          (requestId) => ({
            type: 'pane-shiki-highlight',
            version: SHIKI_PROTOCOL_VERSION,
            requestId,
            code,
            language,
            themes,
          }),
          isShikiHighlightResponse,
          timeoutMs,
        ),
      )
      if (!call.ok) {
        resolve(call)
        return
      }
      resolve(
        call.response.ok
          ? { ok: true, value: call.response.result }
          : { ok: false, error: call.response.error, retryable: false },
      )
    })
  })
}

export function highlightHtmlInSandbox(
  code: string,
  language: BundledLanguage,
  theme: string,
  showLineNumbers: boolean,
  opts: { timeoutMs?: number } = {},
): Promise<ShikiBrokerResult<string>> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUTS.SHIKI_HIGHLIGHT
  return new Promise((resolve) => {
    enqueue(async () => {
      const call = await callWithRetry(() =>
        callSandbox<ShikiHighlightHtmlRequest, ShikiHighlightHtmlResponse>(
          (requestId) => ({
            type: 'pane-shiki-highlight-html',
            version: SHIKI_PROTOCOL_VERSION,
            requestId,
            code,
            language,
            theme,
            showLineNumbers,
          }),
          isShikiHighlightHtmlResponse,
          timeoutMs,
        ),
      )
      if (!call.ok) {
        resolve(call)
        return
      }
      resolve(
        call.response.ok
          ? { ok: true, value: call.response.html }
          : { ok: false, error: call.response.error, retryable: false },
      )
    })
  })
}

function enqueue(task: QueueTask): void {
  queue.push(task)
  void drainQueue()
}

async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length) {
      const task = queue.shift()
      if (!task) break
      await task()
    }
  } finally {
    draining = false
    if (queue.length) void drainQueue()
  }
}

/**
 * One retry, only for a `retryable` failure (sandbox boot timeout, a stuck
 * call that forced a recycle) — a non-retryable failure (the sandbox's own
 * highlighter threw) would very likely fail identically again. Skips the
 * retry if other work is already queued behind this call, so one bad
 * request can't roughly double the wait for everything behind it — same
 * reasoning as mermaid-sandbox-broker.ts's `renderWithRetry`.
 */
async function callWithRetry<TResp>(
  attempt: () => Promise<
    | { ok: true; response: TResp }
    | { ok: false; error: string; retryable: boolean }
  >,
): Promise<
  | { ok: true; response: TResp }
  | { ok: false; error: string; retryable: boolean }
> {
  const result = await attempt()
  if (result.ok || !result.retryable || queue.length > 0) return result
  return attempt()
}

function getSandboxWindow(): Promise<Window> {
  if (sandboxReady) return sandboxReady
  sandboxReady = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('no document'))
      return
    }

    const iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts')
    iframe.style.cssText =
      'position:absolute;width:0;height:0;border:0;visibility:hidden'
    iframe.src = shikiSandboxPageUrl()

    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      iframe.removeEventListener('error', onError)
    }

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('shiki sandbox boot timed out'))
    }, TIMEOUTS.SHIKI_SANDBOX_BOOT)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      if (!isShikiSandboxReady(event.data)) return
      cleanup()
      resolve(iframe.contentWindow as Window)
    }

    const onError = () => {
      cleanup()
      reject(new Error('failed to load shiki sandbox'))
    }

    window.addEventListener('message', onMessage)
    iframe.addEventListener('error', onError)
    document.documentElement.appendChild(iframe)
    sandboxIframe = iframe
  })
  // A failed boot must not poison future calls — drop the cached promise so
  // the next request stands up a fresh sandbox instead of replaying the
  // same rejection forever.
  sandboxReady.catch(() => {
    sandboxIframe?.remove()
    sandboxIframe = null
    sandboxReady = null
  })
  return sandboxReady
}

function recycleSandbox(): void {
  sandboxIframe?.remove()
  sandboxIframe = null
  sandboxReady = null
}

/** Sends one request and resolves with the matching response (by requestId). */
function callSandbox<
  TReq extends { requestId: string },
  TResp extends { requestId: string },
>(
  buildRequest: (requestId: string) => TReq,
  isResponse: (data: unknown) => data is TResp,
  timeoutMs: number,
): Promise<
  | { ok: true; response: TResp }
  | { ok: false; error: string; retryable: boolean }
> {
  return new Promise((resolve) => {
    getSandboxWindow().then(
      (sandboxWindow) => {
        const requestId = `shk-${Date.now()}-${Math.random().toString(36).slice(2)}`
        let settled = false

        const finish = (
          result:
            | { ok: true; response: TResp }
            | { ok: false; error: string; retryable: boolean },
        ) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          window.removeEventListener('message', onMessage)
          resolve(result)
        }

        const timer = setTimeout(() => {
          // A hung call in a persistent sandbox isn't safely resumable —
          // recycle it so the next request gets a fresh instance instead
          // of queueing behind one that will never reply.
          recycleSandbox()
          finish({
            ok: false,
            error: 'shiki sandbox request timed out',
            retryable: true,
          })
        }, timeoutMs)

        const onMessage = (event: MessageEvent) => {
          if (event.source !== sandboxWindow) return
          if (!isResponse(event.data)) return
          if (event.data.requestId !== requestId) return
          finish({ ok: true, response: event.data })
        }

        window.addEventListener('message', onMessage)
        sandboxWindow.postMessage(buildRequest(requestId), '*')
      },
      (err: Error) => {
        resolve({ ok: false, error: err.message, retryable: true })
      },
    )
  })
}
