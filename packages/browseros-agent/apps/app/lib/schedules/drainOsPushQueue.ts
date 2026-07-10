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
