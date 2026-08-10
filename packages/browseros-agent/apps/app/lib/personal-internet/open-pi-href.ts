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

export type OpenPiHrefTarget = { tabId: number; windowId: number }

/**
 * Open a PI page without stealing whatever the user is looking at.
 * - Already on the dedicated PI document → in-place hash navigate (routing
 *   within the PI app itself, not replacing an unrelated page) — returns
 *   null since no tab switch happened, nothing for a caller to follow.
 * - A tab already shows this exact href → focus it (avoids duplicate tabs)
 * - Otherwise → always open a new tab. Never repurpose the user's current
 *   active tab — an agent-initiated PI reveal must not replace a page the
 *   user is reading.
 *
 * Returns the tab/window it made active, so callers (e.g. the side-panel
 * "follow the agent" handoff) know exactly where the user landed.
 */
export async function openPiHref(
  hrefOrRoute: string,
): Promise<OpenPiHrefTarget | null> {
  const href = normalizePiHref(hrefOrRoute)
  if (!href) return null

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
      return null
    }
  }

  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return null
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
      return { tabId: match.id, windowId: match.windowId }
    }
    return null
  }

  const created = await chrome.tabs.create({ url: href, active: true })
  if (created?.id == null || created.windowId == null) return null
  return { tabId: created.id, windowId: created.windowId }
}
