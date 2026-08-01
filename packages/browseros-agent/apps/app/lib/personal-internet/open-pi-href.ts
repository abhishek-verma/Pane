/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Open a PI page without stealing Home / chat.
 * Canonical document is pi.html; never rewrite #/home.
 */

import { parseAttachablePiHref } from './attachable-tab-url'
import { hrefToRoute, parsePiHref, routeToHref } from './pi-href'

/** Normalize to a canonical pi:// href, or null. */
export function normalizePiHref(input: string): string | null {
  const s = input.trim()
  if (s.startsWith('pi://')) {
    return parsePiHref(s) ? s.replace(/\/+$/, '') || s : null
  }
  if (s.startsWith('#/pi/') || s.startsWith('/pi/')) {
    const route = s.startsWith('#') ? s : `#${s}`
    return routeToHref(route)
  }
  return parseAttachablePiHref(s)
}

/** Only an already-valid PI document may change PI routes in place. */
export function canNavigatePiInPlace(pathname: string, hash: string): boolean {
  return (
    pathname.endsWith('/pi.html') &&
    (hash.startsWith('#/pi/') || hash === '#/pi')
  )
}

/**
 * Open a PI page without stealing Home / chat.
 * - Already on the dedicated PI document → in-place hash navigate
 * - Otherwise → focus a tab already on this href, or create a new pi:// tab
 */
export async function openPiHref(hrefOrRoute: string): Promise<void> {
  const href = normalizePiHref(hrefOrRoute)
  if (!href) return

  const route = hrefToRoute(href)
  // Some test/runtime shells define `window` without `location`.
  const location = typeof window !== 'undefined' ? window.location : undefined
  if (route && location) {
    const path = location.pathname
    const hash = location.hash
    // In-place only on the dedicated PI document — never on Home/chat NTP.
    if (canNavigatePiInPlace(path, hash)) {
      const next = route.startsWith('#') ? route.slice(1) : route
      location.hash = next.startsWith('/') ? next : `/${next}`
      return
    }
  }

  if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
    return
  }

  const tabs = await chrome.tabs.query({})
  const match = tabs.find((t) => parseAttachablePiHref(t.url) === href)
  if (match?.id != null) {
    // Prefer the canonical pi:// URL so legacy NTP/app.html tabs migrate.
    await chrome.tabs.update(match.id, { url: href, active: true })
    if (match.windowId != null) {
      await chrome.windows.update(match.windowId, { focused: true })
    }
    return
  }

  await chrome.tabs.create({ url: href, active: true })
}
