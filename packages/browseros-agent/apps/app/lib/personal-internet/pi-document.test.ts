/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import { isPiDocument, isPiRoutePath } from './pi-document'

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
})
