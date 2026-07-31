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

function tabMatchesHref(url: string | undefined, href: string): boolean {
  if (!url) return false
  if (url === href || url.startsWith(`${href}/`)) return true
  const route = hrefToRoute(href)
  if (!route) return false
  const hash = route.startsWith('#') ? route : `#${route}`
  return url.includes(hash)
}

/**
 * Open a PI page without stealing Home / chat.
 * - Already on a PI route in this document → in-place hash navigate
 * - Otherwise → focus a tab already on this href, or create a new pi:// tab
 */
export async function openPiHref(hrefOrRoute: string): Promise<void> {
  const href = normalizePiHref(hrefOrRoute)
  if (!href) return

  const route = hrefToRoute(href)
  if (route && typeof window !== 'undefined') {
    const hash = window.location.hash
    // Never rewrite #/home (or other non-PI shells) — that kills the chat UI.
    if (hash.startsWith('#/pi/') || hash === '#/pi') {
      const path = route.startsWith('#') ? route.slice(1) : route
      window.location.hash = path.startsWith('/') ? path : `/${path}`
      return
    }
  }

  if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
    return
  }

  const tabs = await chrome.tabs.query({})
  const match = tabs.find((t) => tabMatchesHref(t.url, href))
  if (match?.id != null) {
    await chrome.tabs.update(match.id, { url: href, active: true })
    if (match.windowId != null) {
      await chrome.windows.update(match.windowId, { focused: true })
    }
    return
  }

  await chrome.tabs.create({ url: href, active: true })
}
