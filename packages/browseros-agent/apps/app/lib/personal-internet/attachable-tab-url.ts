/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Which tab URLs can be attached in chat, and how PI tabs are shown.
 *
 * Canonical internal document is pi.html#/pi/…. Legacy app.html / NTP forms
 * are accepted only so stranded tabs remain attachable until migration.
 */

import { parsePiHref, routeToHref } from './pi-href'

/** Extract a PI hash (`#/pi/…`) from a tab or document URL, if present. */
function piHashFromUrl(url: string): string | null {
  const hashIndex = url.indexOf('#')
  if (hashIndex < 0) return null
  const hash = url.slice(hashIndex)
  if (!hash.startsWith('#/pi/') && hash !== '#/pi') return null
  return hash === '#/pi' ? '#/pi/library' : hash
}

/**
 * Parse any known PI tab/document URL into a canonical `pi://` href.
 * Returns null when the URL is not a PI page.
 */
export function parseAttachablePiHref(url: string | undefined): string | null {
  if (!url) return null

  if (url.startsWith('pi://')) {
    return parsePiHref(url) ? url.replace(/\/+$/, '') || url : null
  }

  const hash = piHashFromUrl(url)
  if (!hash) return null

  // Canonical: chrome-extension://…/pi.html#/pi/…
  if (url.includes('/pi.html')) {
    return routeToHref(hash)
  }

  // Migration: chrome-extension://…/app.html#/pi/… or chrome://newtab/#/pi/…
  if (
    url.includes('/app.html') ||
    url.startsWith('chrome://newtab') ||
    url.startsWith('chrome://new-tab-page')
  ) {
    return routeToHref(hash)
  }

  return null
}

/** Tabs the user can @-mention / attach for the agent. */
export function isAttachableTabUrl(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('http://') || url.startsWith('https://')) return true
  return parseAttachablePiHref(url) != null
}

/**
 * Prefer pi:// for PI pages so the picker and agent context match product
 * addresses regardless of the underlying document URL.
 */
export function displayTabUrl(url: string | undefined): string {
  if (!url) return ''
  return parseAttachablePiHref(url) ?? url
}
