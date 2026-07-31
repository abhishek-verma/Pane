/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import {
  appDocumentUrl,
  defaultPiDocumentHash,
  documentForRoute,
  isPiDocument,
  isPiRoutePath,
  piDocumentUrl,
} from './pi-document'

describe('pi-document', () => {
  test('detects pi.html pathname', () => {
    expect(isPiDocument('/pi.html')).toBe(true)
    expect(
      isPiDocument(
        '/chrome-extension/biedncddmddkpapdplhcnkhhplnfgbif/pi.html',
      ),
    ).toBe(true)
    expect(isPiDocument('/app.html')).toBe(false)
  })

  test('detects PI routes', () => {
    expect(isPiRoutePath('/pi/library')).toBe(true)
    expect(isPiRoutePath('/pi/sites/s1')).toBe(true)
    expect(isPiRoutePath('/pi')).toBe(true)
    expect(isPiRoutePath('/home')).toBe(false)
    expect(isPiRoutePath('/settings/ai')).toBe(false)
  })

  test('assigns every route to its owning document', () => {
    expect(documentForRoute('/pi')).toBe('pi')
    expect(documentForRoute('/pi/library')).toBe('pi')
    expect(documentForRoute('/pi/sites/s1')).toBe('pi')
    expect(documentForRoute('/home')).toBe('app')
    expect(documentForRoute('/settings/ai')).toBe('app')
    expect(documentForRoute('/unknown')).toBe('app')
  })

  test('piDocumentUrl targets pi.html with hash route', () => {
    expect(
      piDocumentUrl('/pi/sites/s1', (p) => `chrome-extension://id/${p}`),
    ).toBe('chrome-extension://id/pi.html#/pi/sites/s1')
  })

  test('appDocumentUrl targets app.html with hash route', () => {
    expect(
      appDocumentUrl('/settings/ai', (p) => `chrome-extension://id/${p}`),
    ).toBe('chrome-extension://id/app.html#/settings/ai')
  })

  test('defaults only a bare pi.html document to the library', () => {
    expect(defaultPiDocumentHash('')).toBe('#/pi/library')
    expect(defaultPiDocumentHash('#')).toBe('#/pi/library')
    expect(defaultPiDocumentHash('#/pi/sites/s1')).toBeNull()
    expect(defaultPiDocumentHash('#/home')).toBeNull()
  })
})
