/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  extensionDocumentForHash,
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

  it('keeps canonical PI urls', () => {
    expect(resolveNotificationClickTarget('pi://sites/site_1')).toEqual({
      kind: 'url',
      url: 'pi://sites/site_1',
    })
  })

  it('keeps extension hash deep links', () => {
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

describe('extensionDocumentForHash', () => {
  it('routes PI hashes to pi.html', () => {
    expect(extensionDocumentForHash('#/pi')).toBe('pi.html')
    expect(extensionDocumentForHash('#/pi/library')).toBe('pi.html')
    expect(extensionDocumentForHash('#/pi/sites/site_1?view=board')).toBe(
      'pi.html',
    )
  })

  it('routes application hashes to app.html', () => {
    expect(extensionDocumentForHash('#/home')).toBe('app.html')
    expect(extensionDocumentForHash('#/settings/ai')).toBe('app.html')
  })
})
