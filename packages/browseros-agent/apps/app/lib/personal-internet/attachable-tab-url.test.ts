/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import {
  displayTabUrl,
  isAttachableTabUrl,
  parseAttachablePiHref,
} from './attachable-tab-url'
import { normalizePiHref } from './open-pi-href'

const EXT = 'chrome-extension://biedncddmddkpapdplhcnkhhplnfgbif'

describe('attachable-tab-url', () => {
  test('allows http(s) and pi://', () => {
    expect(isAttachableTabUrl('https://example.com')).toBe(true)
    expect(isAttachableTabUrl('pi://sites/s1')).toBe(true)
    expect(isAttachableTabUrl('chrome://settings')).toBe(false)
  })

  test('canonical pi.html PI routes', () => {
    const url = `${EXT}/pi.html#/pi/sites/s1`
    expect(parseAttachablePiHref(url)).toBe('pi://sites/s1')
    expect(isAttachableTabUrl(url)).toBe(true)
    expect(displayTabUrl(url)).toBe('pi://sites/s1')
  })

  test('migration: app.html and chrome://newtab PI hashes', () => {
    expect(parseAttachablePiHref(`${EXT}/app.html#/pi/sites/s1`)).toBe(
      'pi://sites/s1',
    )
    expect(
      parseAttachablePiHref(
        'chrome://newtab/#/pi/sites/site_2bca/pages/page_429d',
      ),
    ).toBe('pi://sites/site_2bca/pages/page_429d')
    expect(
      isAttachableTabUrl(
        'chrome://newtab/#/pi/sites/site_2bca/pages/page_429d',
      ),
    ).toBe(true)
  })

  test('rejects non-PI home/chat shells', () => {
    const home = `${EXT}/app.html#/home`
    expect(isAttachableTabUrl(home)).toBe(false)
    expect(displayTabUrl(home)).toBe(home)
    expect(isAttachableTabUrl('chrome://newtab/')).toBe(false)
    expect(isAttachableTabUrl(`${EXT}/pi.html#/home`)).toBe(false)
  })
})

describe('normalizePiHref', () => {
  test('accepts pi:// and hash routes', () => {
    expect(normalizePiHref('pi://sites/s1')).toBe('pi://sites/s1')
    expect(normalizePiHref('#/pi/sites/s1')).toBe('pi://sites/s1')
    expect(normalizePiHref('https://example.com')).toBeNull()
  })
})
