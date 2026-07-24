/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { Hono } from 'hono'
import { requireProfile } from '../../src/api/middleware/require-profile'
import { closeDb, getDb, initializeDb } from '../../src/lib/db'
import { tryGetProfileKey } from '../../src/lib/profile-context'
import { resetLegacyClaimForTests } from '../../src/lib/profile-legacy-migrate'

const PROFILE = '33333333-3333-4333-8333-333333333333'

describe('requireProfile middleware', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-require-profile-'))
    process.env.BROWSEROS_DIR = dir
    resetLegacyClaimForTests()
    closeDb()
    initializeDb({})
  })

  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    resetLegacyClaimForTests()
  })

  function app() {
    return new Hono().use('/*', requireProfile()).get('/probe', (c) =>
      c.json({
        profileKey: tryGetProfileKey(),
        dbReady: Boolean(getDb()),
      }),
    )
  }

  it('rejects missing profile header', async () => {
    const res = await app().request('/probe')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain(BROWSEROS_PROFILE_ID_HEADER)
  })

  it('rejects invalid profile header', async () => {
    const res = await app().request('/probe', {
      headers: { [BROWSEROS_PROFILE_ID_HEADER]: 'Default' },
    })
    expect(res.status).toBe(400)
  })

  it('accepts a valid UUID and binds profile context', async () => {
    const res = await app().request('/probe', {
      headers: { [BROWSEROS_PROFILE_ID_HEADER]: PROFILE },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { profileKey: string; dbReady: boolean }
    expect(body.profileKey).toBe(PROFILE)
    expect(body.dbReady).toBe(true)
  })
})
