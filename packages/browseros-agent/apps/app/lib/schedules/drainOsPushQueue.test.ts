/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  type QueuedOsNotification,
  toChromeNotificationOptions,
} from '@/lib/schedules/drainOsPushQueue'

describe('toChromeNotificationOptions', () => {
  it('maps queue items to chrome.notifications options', () => {
    const item: QueuedOsNotification = {
      id: 'osn_1',
      title: 'Pane trigger ready',
      body: 'A trigger run is waiting',
      deepLink: 'browseros://scheduled-runs/run_1',
      createdAt: 1,
    }
    expect(toChromeNotificationOptions(item)).toEqual({
      type: 'basic',
      iconUrl: 'icon/48.png',
      title: 'Pane trigger ready',
      message: 'A trigger run is waiting',
    })
  })
})
