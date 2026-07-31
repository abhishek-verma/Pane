/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import { displayTabUrl, isAttachableTabUrl } from './attachable-tab-url'
import { normalizePiHref } from './open-pi-href'

describe('attachable-tab-url', () => {
  test('allows http(s) and pi://', () => {
    expect(isAttachableTabUrl('https://example.com')).toBe(true)
    expect(isAttachableTabUrl('pi://sites/s1')).toBe(true)
    expect(isAttachableTabUrl('chrome://settings')).toBe(false)
  })

  test('allows extension PI hash routes', () => {
    const url =
      'chrome-extension://biedncddmddkpapdplhcnkhhplnfgbif/app.html#/pi/sites/s1'
    expect(isAttachableTabUrl(url)).toBe(true)
    expect(displayTabUrl(url)).toBe('pi://sites/s1')
  })

  test('rejects extension non-PI routes', () => {
    const url =
      'chrome-extension://biedncddmddkpapdplhcnkhhplnfgbif/app.html#/home'
    expect(isAttachableTabUrl(url)).toBe(false)
    expect(displayTabUrl(url)).toBe(url)
  })
})

describe('normalizePiHref', () => {
  test('accepts pi:// and hash routes', () => {
    expect(normalizePiHref('pi://sites/s1')).toBe('pi://sites/s1')
    expect(normalizePiHref('#/pi/sites/s1')).toBe('pi://sites/s1')
    expect(normalizePiHref('https://example.com')).toBeNull()
  })
})
