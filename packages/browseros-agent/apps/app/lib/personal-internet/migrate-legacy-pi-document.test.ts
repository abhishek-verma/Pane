/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import {
  buildPiDocumentUrl,
  isLegacyPiHashOnAppDocument,
  migrateLegacyPiDocumentIfNeeded,
} from './migrate-legacy-pi-document'

describe('migrate-legacy-pi-document', () => {
  test('detects PI hashes', () => {
    expect(isLegacyPiHashOnAppDocument('#/pi/sites/s1')).toBe(true)
    expect(isLegacyPiHashOnAppDocument('#/pi')).toBe(true)
    expect(isLegacyPiHashOnAppDocument('#/home')).toBe(false)
    expect(isLegacyPiHashOnAppDocument('#/home/chat')).toBe(false)
  })

  test('builds pi.html URL preserving search and hash', () => {
    expect(
      buildPiDocumentUrl(
        '#/pi/sites/s1',
        '?x=1',
        (p) => `chrome-extension://id/${p}`,
      ),
    ).toBe('chrome-extension://id/pi.html?x=1#/pi/sites/s1')
    expect(
      buildPiDocumentUrl('#/home', '', (p) => `chrome-extension://id/${p}`),
    ).toBeNull()
  })

  test('replace-navigates only for PI hashes', () => {
    const replaced: string[] = []
    const ok = migrateLegacyPiDocumentIfNeeded(
      {
        hash: '#/pi/library',
        search: '',
        replace: (url: string) => {
          replaced.push(url)
        },
      },
      (p) => `chrome-extension://id/${p}`,
    )
    expect(ok).toBe(true)
    expect(replaced).toEqual(['chrome-extension://id/pi.html#/pi/library'])

    const skipped = migrateLegacyPiDocumentIfNeeded(
      {
        hash: '#/home',
        search: '',
        replace: () => {
          throw new Error('must not replace')
        },
      },
      (p) => `chrome-extension://id/${p}`,
    )
    expect(skipped).toBe(false)
  })
})
