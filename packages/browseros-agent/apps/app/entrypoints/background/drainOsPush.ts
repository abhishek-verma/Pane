/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Drains server OS-push queue into chrome.notifications.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { openPiHref } from '@/lib/personal-internet/open-pi-href'
import {
  type ChromeNotificationOptions,
  drainOsPushQueueOnce,
  extensionDocumentForHash,
  resolveNotificationClickTarget,
} from '@/lib/schedules/drainOsPushQueue'

const ALARM_NAME = 'drain-os-push'
const PERIOD_MINUTES = 0.5

export type {
  ChromeNotificationOptions,
  QueuedOsNotification,
} from '@/lib/schedules/drainOsPushQueue'
export {
  drainOsPushQueueOnce,
  resolveNotificationClickTarget,
  toChromeNotificationOptions,
} from '@/lib/schedules/drainOsPushQueue'

function defaultCreateNotification(
  notificationId: string,
  options: ChromeNotificationOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.notifications.create(notificationId, options, (id) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(id)
    })
  })
}

export function drainOsPush(): void {
  const deepLinkById = new Map<string, string>()
  let draining = false

  const tick = async () => {
    if (draining) return
    draining = true
    try {
      const { deepLinks } = await drainOsPushQueueOnce({
        getBaseUrl: getAgentServerUrl,
        fetchFn: agentFetch as typeof fetch,
        createNotification: defaultCreateNotification,
      })
      for (const [id, link] of deepLinks) {
        if (link) deepLinkById.set(id, link)
      }
    } catch {
      // Server may be down — retry next alarm.
    } finally {
      draining = false
    }
  }

  void chrome.alarms.create(ALARM_NAME, { periodInMinutes: PERIOD_MINUTES })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void tick()
  })

  // Without this, a dismissed-not-clicked notification's entry (the common
  // case) never leaves the map for as long as the service worker stays
  // resident. Deferred rather than immediate: Chrome does not guarantee
  // onClosed fires strictly after onClicked when a click also closes the
  // notification (platform-dependent) — an immediate delete here could
  // race onClicked's own read of the same entry and silently drop a real
  // click. A few seconds of extra retention on an already-rare path is a
  // better trade than an intermittently-broken notification click.
  chrome.notifications.onClosed.addListener((notificationId) => {
    setTimeout(() => deepLinkById.delete(notificationId), 3_000)
  })

  chrome.notifications.onClicked.addListener((notificationId) => {
    const deepLink = deepLinkById.get(notificationId)
    deepLinkById.delete(notificationId)
    if (!deepLink) return
    const target = resolveNotificationClickTarget(deepLink)
    if (!target) return
    if (target.kind === 'url') {
      if (target.url.startsWith('pi://')) {
        void openPiHref(target.url)
        return
      }
      void chrome.tabs.create({ url: target.url })
      return
    }
    if (target.hash === '#/pi' || target.hash.startsWith('#/pi/')) {
      void openPiHref(target.hash)
      return
    }
    void chrome.tabs.create({
      url: chrome.runtime.getURL(
        `${extensionDocumentForHash(target.hash)}${target.hash}`,
      ),
    })
  })

  chrome.runtime.onStartup.addListener(() => {
    void tick()
  })
  chrome.runtime.onInstalled.addListener(() => {
    void tick()
  })
}
