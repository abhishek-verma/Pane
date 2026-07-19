/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getCaptureConsent,
  isProtectedCaptureDomain,
  requireCaptureConsent,
  setCaptureConsent,
} from '../../src/capture/consent'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('capture consent', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-capture-consent-'))
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  })

  afterEach(() => {
    closeDb()
  })

  it('is off by default until explicitly allowed', () => {
    setCaptureConsent({
      domain: 'meet.google.com',
      class: 'meeting',
      allowed: false,
    })
    expect(getCaptureConsent('https://meet.google.com/abc', 'meeting')).toEqual(
      expect.objectContaining({ allowed: false }),
    )
  })

  it('blocks protected domains even when user opts in', () => {
    const consent = setCaptureConsent({
      domain: 'chase.bank.com',
      class: 'browsing',
      allowed: true,
    })
    expect(isProtectedCaptureDomain('chase.bank.com')).toBe(true)
    expect(consent.allowed).toBe(false)
  })

  it('allows Zoom subdomain when zoom.us consent is set (A-T5)', () => {
    setCaptureConsent({
      domain: 'zoom.us',
      class: 'meeting',
      allowed: true,
    })
    expect(
      requireCaptureConsent('https://us02web.zoom.us/j/123', 'meeting').domain,
    ).toBe('zoom.us')
  })
})
