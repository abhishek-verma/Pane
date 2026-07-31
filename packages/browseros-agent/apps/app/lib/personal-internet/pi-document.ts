/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * The dedicated PI document (pi.html) vs the NTP/home shell (app.html).
 */

/** True when the current page is the dedicated PI document. */
export function isPiDocument(
  pathname: string = typeof window !== 'undefined'
    ? window.location.pathname
    : '',
): boolean {
  return pathname.endsWith('/pi.html')
}

/** True when a hash-router path belongs on the PI document. */
export function isPiRoutePath(pathname: string): boolean {
  return pathname === '/pi' || pathname.startsWith('/pi/')
}

export type PaneDocument = 'app' | 'pi'

/** The extension document that owns a HashRouter pathname. */
export function documentForRoute(pathname: string): PaneDocument {
  return isPiRoutePath(pathname) ? 'pi' : 'app'
}

/** Canonical app.html URL for a HashRouter application path. */
export function appDocumentUrl(
  path: string,
  getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${getUrl('app.html')}#${normalized}`
}

/**
 * Leave the PI document for the NTP/home shell (app.html).
 * `path` is a HashRouter path like `/home` or `/settings/ai`.
 */
export function navigateAppShell(
  path: string,
  getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
): void {
  window.location.href = appDocumentUrl(path, getUrl)
}

/**
 * Canonical pi.html URL for a HashRouter PI path (`/pi/library`, …).
 */
export function piDocumentUrl(
  path: string,
  getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${getUrl('pi.html')}#${normalized}`
}

/**
 * Leave the NTP/home shell for the dedicated PI document (pi.html).
 * `path` is a HashRouter path like `/pi/library` or `/pi/sites/s1`.
 */
export function navigatePiDocument(
  path: string,
  getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
): void {
  window.location.href = piDocumentUrl(path, getUrl)
}

/**
 * Replace an intermediate wrong-document hash entry during a guard transfer.
 * This keeps Back/Forward from immediately remigrating to the same page.
 */
export function replaceAppDocument(
  path: string,
  getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
): void {
  window.location.replace(appDocumentUrl(path, getUrl))
}

export function replacePiDocument(
  path: string,
  getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
): void {
  window.location.replace(piDocumentUrl(path, getUrl))
}

/** Empty pi.html loads land on the library; explicit hashes are preserved. */
export function defaultPiDocumentHash(hash: string): string | null {
  return hash === '' || hash === '#' ? '#/pi/library' : null
}

/**
 * HashRouter navigation that respects document ownership.
 * Same-document hops stay in-place; cross-document hops hard-navigate.
 */
export function navigateOwnedRoute(route: string): void {
  const path = route.startsWith('#')
    ? route.slice(1)
    : route.startsWith('/')
      ? route
      : `/${route}`
  const target = documentForRoute(path)
  if (target === 'pi' && !isPiDocument()) {
    replacePiDocument(path)
    return
  }
  if (target === 'app' && isPiDocument()) {
    replaceAppDocument(path)
    return
  }
  window.location.hash = path.startsWith('/') ? path : `/${path}`
}
