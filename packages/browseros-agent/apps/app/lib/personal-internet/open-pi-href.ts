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
 * - Otherwise → update the current active tab to this href, or focus a tab
 *   already showing it (avoids duplicate PI tabs)
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

  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return
  }

  const tabs = await chrome.tabs.query({})
  const match = tabs.find((t) => parseAttachablePiHref(t.url) === href)
  if (match?.id != null) {
    // Canonical pi.html tab → just focus; legacy NTP/app.html tab → migrate URL too.
    const needsMigration =
      match.url != null &&
      !match.url.startsWith('pi://') &&
      !match.url.includes('/pi.html')
    const updateProps = needsMigration
      ? { url: href, active: true }
      : { active: true }
    await chrome.tabs.update(match.id, updateProps)
    if (match.windowId != null) {
      await chrome.windows.update(match.windowId, { focused: true })
    }
    return
  }

  // Navigate the current active tab — agent-initiated open should feel like
  // navigation, not a new background tab appearing.
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })
  if (activeTab?.id != null) {
    await chrome.tabs.update(activeTab.id, { url: href })
    return
  }

  await chrome.tabs.create({ url: href, active: true })
}
