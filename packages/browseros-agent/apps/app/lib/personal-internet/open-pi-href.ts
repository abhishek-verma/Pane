/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

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
  return null
}

/**
 * Open a PI page in Pane via the registered pi:// scheme (Chromium rewrite).
 * Prefers focusing an existing NTP/app tab when possible.
 */
export async function openPiHref(hrefOrRoute: string): Promise<void> {
  const href = normalizePiHref(hrefOrRoute)
  if (!href) return

  // Same-document: already on the agent app HashRouter.
  const route = hrefToRoute(href)
  if (route && typeof window !== 'undefined') {
    const here = window.location.href
    if (
      here.includes('app.html') ||
      here.includes('chrome-extension://') ||
      window.location.hash.startsWith('#/pi') ||
      window.location.hash.startsWith('#/home')
    ) {
      const path = route.startsWith('#') ? route.slice(1) : route
      window.location.hash = path.startsWith('/') ? path : `/${path}`
      return
    }
  }

  if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
    if (route) {
      window.location.hash = route.startsWith('#') ? route.slice(1) : route
    }
    return
  }

  const tabs = await chrome.tabs.query({
    url: [`chrome-extension://${chrome.runtime.id}/*`],
  })
  const appTab = tabs.find(
    (t) =>
      typeof t.url === 'string' &&
      (t.url.includes('/app.html') || t.url.includes('app.html')),
  )
  if (appTab?.id != null) {
    await chrome.tabs.update(appTab.id, { url: href, active: true })
    if (appTab.windowId != null) {
      await chrome.windows.update(appTab.windowId, { focused: true })
    }
    return
  }

  await chrome.tabs.create({ url: href, active: true })
}
