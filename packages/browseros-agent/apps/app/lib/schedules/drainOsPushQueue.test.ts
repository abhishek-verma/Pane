/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  type QueuedOsNotification,
  resolveNotificationClickTarget,
  toChromeNotificationOptions,
} from '@/lib/schedules/drainOsPushQueue'

describe('toChromeNotificationOptions', () => {
  it('maps queue items to chrome.notifications options', () => {
    const item: QueuedOsNotification = {
      id: 'osn_1',
      title: 'Pane trigger ready',
      body: 'A trigger run is waiting',
      deepLink: '#/home',
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

describe('resolveNotificationClickTarget', () => {
  it('keeps http(s) urls', () => {
    expect(resolveNotificationClickTarget('https://example.com/x')).toEqual({
      kind: 'url',
      url: 'https://example.com/x',
    })
  })

  it('keeps hash deep links for newtab', () => {
    expect(resolveNotificationClickTarget('#/home')).toEqual({
      kind: 'hash',
      hash: '#/home',
    })
  })

  it('maps legacy browseros:// schemes to home hash', () => {
    expect(
      resolveNotificationClickTarget('browseros://scheduled-runs/run_1'),
    ).toEqual({ kind: 'hash', hash: '#/home' })
  })
})
