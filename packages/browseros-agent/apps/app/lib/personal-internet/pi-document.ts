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

/**
 * Leave the PI document for the NTP/home shell (app.html).
 * `path` is a HashRouter path like `/home` or `/settings/ai`.
 */
export function navigateAppShell(
  path: string,
  getUrl: (path: string) => string = (p) => chrome.runtime.getURL(p),
): void {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const hash = `#${normalized}`
  window.location.href = `${getUrl('app.html')}${hash}`
}
