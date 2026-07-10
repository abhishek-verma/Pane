/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * OS push from the server path. Primary path for interactive sessions is
 * chrome.notifications in the app; keep-alive / server-only uses a local
 * notifier queue that the app can drain on attach, plus optional
 * node-style console/log fallback. Never uses a Pane cloud push service.
 */

import { logger } from '../lib/logger'
import type { ReachMessage, ReachTransport } from './types'

export interface QueuedOsNotification {
  id: string
  title: string
  body: string
  deepLink?: string
  createdAt: number
}

const queue: QueuedOsNotification[] = []

export function drainOsNotificationQueue(): QueuedOsNotification[] {
  return queue.splice(0, queue.length)
}

export function peekOsNotificationQueue(): QueuedOsNotification[] {
  return [...queue]
}

export function createOsPushTransport(options?: {
  /** Injected for tests / platform notifiers */
  deliver?: (msg: ReachMessage) => Promise<void>
}): ReachTransport {
  return {
    id: 'os-push',
    async isConfigured() {
      return true
    },
    async send(msg) {
      if (options?.deliver) {
        await options.deliver(msg)
        return
      }
      const item: QueuedOsNotification = {
        id: `osn_${crypto.randomUUID().slice(0, 12)}`,
        title: msg.title,
        body: msg.body,
        deepLink: msg.deepLink,
        createdAt: Date.now(),
      }
      queue.push(item)
      logger.info('os-push queued for app attach', {
        id: item.id,
        title: item.title,
      })
    },
  }
}
