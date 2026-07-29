/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const CHANNEL = 'pane-pi'

export type PiInvalidateMessage = {
  type: 'invalidate'
  siteId?: string
}

export function emitPiInvalidate(siteId?: string): void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    const msg: PiInvalidateMessage = { type: 'invalidate', siteId }
    ch.postMessage(msg)
    ch.close()
  } catch {
    // BroadcastChannel unavailable (tests / older envs)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('pane-pi-invalidate', { detail: { siteId } }),
    )
  }
}

export function subscribePiInvalidate(
  handler: (msg: PiInvalidateMessage) => void,
): () => void {
  let ch: BroadcastChannel | null = null
  try {
    ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (ev) => {
      const data = ev.data as PiInvalidateMessage
      if (data?.type === 'invalidate') handler(data)
    }
  } catch {
    ch = null
  }
  const onCustom = (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { siteId?: string }
    handler({ type: 'invalidate', siteId: detail?.siteId })
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pane-pi-invalidate', onCustom)
    window.addEventListener('focus', onFocus)
  }
  function onFocus() {
    handler({ type: 'invalidate' })
  }
  return () => {
    ch?.close()
    if (typeof window !== 'undefined') {
      window.removeEventListener('pane-pi-invalidate', onCustom)
      window.removeEventListener('focus', onFocus)
    }
  }
}

/** Paths that mutate PI state when called with write methods. */
export function shouldInvalidateFromPiFetch(
  url: string,
  method: string,
): boolean {
  const m = method.toUpperCase()
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(m)) return false
  try {
    const path = new URL(url, 'http://local').pathname
    return path.includes('/pi/')
  } catch {
    return url.includes('/pi/')
  }
}
