/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * One-way migration: app.html (NTP) must not host PI routes. Send them to
 * the dedicated pi.html document before React mounts.
 */

/** True when this document is the NTP/home shell carrying a PI hash. */
export function isLegacyPiHashOnAppDocument(hash: string): boolean {
  return hash.startsWith('#/pi/') || hash === '#/pi'
}

/**
 * Build the canonical pi.html URL for a legacy `#/pi/…` hash.
 * Returns null when chrome.runtime is unavailable (tests / non-extension).
 */
export function buildPiDocumentUrl(
  hash: string,
  search = '',
  getUrl: (path: string) => string = (path) => chrome.runtime.getURL(path),
): string | null {
  if (!isLegacyPiHashOnAppDocument(hash)) return null
  try {
    const base = getUrl('pi.html')
    return `${base}${search}${hash}`
  } catch {
    return null
  }
}

/**
 * If the current location is app.html with a PI hash, replace it with pi.html.
 * Returns true when a navigation was started (caller should not mount React).
 */
export function migrateLegacyPiDocumentIfNeeded(
  location: Pick<Location, 'hash' | 'search' | 'replace'> = window.location,
  getUrl: (path: string) => string = (path) => chrome.runtime.getURL(path),
): boolean {
  const next = buildPiDocumentUrl(location.hash, location.search, getUrl)
  if (!next) return false
  location.replace(next)
  return true
}
