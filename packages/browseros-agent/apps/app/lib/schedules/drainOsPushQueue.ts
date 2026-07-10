/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pure OS-push → notification mapping (no extension imports).
 */

export interface QueuedOsNotification {
  id: string
  title: string
  body: string
  deepLink?: string
  createdAt: number
}

export interface ChromeNotificationOptions {
  type: 'basic'
  iconUrl: string
  title: string
  message: string
}

export function toChromeNotificationOptions(
  item: QueuedOsNotification,
  iconUrl = 'icon/48.png',
): ChromeNotificationOptions {
  return {
    type: 'basic',
    iconUrl,
    title: item.title,
    message: item.body,
  }
}

/**
 * Resolve a reach deepLink into something chrome.tabs / newtab can open.
 * Returns `{ kind: 'url', url }` for absolute http(s), or `{ kind: 'hash', hash }`
 * for in-extension navigation (caller prefixes with newtab.html).
 */
export function resolveNotificationClickTarget(
  deepLink: string,
): { kind: 'url'; url: string } | { kind: 'hash'; hash: string } | null {
  if (deepLink.startsWith('http://') || deepLink.startsWith('https://')) {
    return { kind: 'url', url: deepLink }
  }
  if (deepLink.startsWith('#')) {
    return { kind: 'hash', hash: deepLink }
  }
  // Legacy custom scheme from early Phase 5 — map to home.
  if (deepLink.startsWith('browseros://')) {
    return { kind: 'hash', hash: '#/home' }
  }
  return null
}

export interface DrainOsPushDeps {
  getBaseUrl: () => Promise<string>
  fetchFn: typeof fetch
  createNotification: (
    notificationId: string,
    options: ChromeNotificationOptions,
  ) => Promise<string>
}

export async function drainOsPushQueueOnce(deps: DrainOsPushDeps): Promise<{
  delivered: number
  deepLinks: Map<string, string | undefined>
}> {
  const base = await deps.getBaseUrl()
  const res = await deps.fetchFn(`${base}/reach/os-push/queue`)
  if (!res.ok) {
    throw new Error(`os-push queue failed: ${res.status}`)
  }
  const body = (await res.json()) as { notifications?: QueuedOsNotification[] }
  const items = body.notifications ?? []
  const deepLinks = new Map<string, string | undefined>()

  for (const item of items) {
    const options = toChromeNotificationOptions(item)
    await deps.createNotification(item.id, options)
    deepLinks.set(item.id, item.deepLink)
  }

  return { delivered: items.length, deepLinks }
}
