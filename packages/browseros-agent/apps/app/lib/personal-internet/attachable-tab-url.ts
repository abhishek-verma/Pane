/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Which tab URLs can be attached in chat, and how PI tabs are shown.
 */

import { parsePiHref, routeToHref } from './pi-href'

/** Hash fragment for a PI SPA route, if present on an extension app URL. */
function piHashFromExtensionUrl(url: string): string | null {
  const hashIndex = url.indexOf('#')
  if (hashIndex < 0) return null
  const hash = url.slice(hashIndex)
  if (!hash.startsWith('#/pi/')) return null
  return hash
}

/** Tabs the user can @-mention / attach for the agent. */
export function isAttachableTabUrl(url: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('http://') || url.startsWith('https://')) return true
  if (url.startsWith('pi://')) return parsePiHref(url) != null
  if (url.startsWith('chrome-extension://')) {
    const hash = piHashFromExtensionUrl(url)
    return hash != null && routeToHref(hash) != null
  }
  return false
}

/**
 * Prefer pi:// for PI pages so the picker and agent context match product
 * addresses (tab.url is often still chrome-extension://…#/pi/…).
 */
export function displayTabUrl(url: string | undefined): string {
  if (!url) return ''
  if (url.startsWith('pi://')) return url
  if (url.startsWith('chrome-extension://')) {
    const hash = piHashFromExtensionUrl(url)
    if (hash) {
      const href = routeToHref(hash)
      if (href) return href
    }
  }
  return url
}
