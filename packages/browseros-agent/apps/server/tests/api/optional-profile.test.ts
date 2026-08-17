/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { Hono } from 'hono'
import { optionalProfile } from '../../src/api/middleware/optional-profile'
import { closeDb, initializeDb } from '../../src/lib/db'
import { tryGetProfileKey } from '../../src/lib/profile-context'
import { resetLegacyClaimForTests } from '../../src/lib/profile-legacy-migrate'

const PROFILE_A = '33333333-3333-4333-8333-333333333333'
const PROFILE_B = '44444444-4444-4444-8444-444444444444'

describe('optionalProfile middleware', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'browseros-optional-profile-'))
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
    return new Hono()
      .use('/*', optionalProfile())
      .get('/probe', (c) => c.json({ profileKey: tryGetProfileKey() }))
  }

  it('binds the header profile when present', async () => {
    const res = await app().request('/probe', {
      headers: { [BROWSEROS_PROFILE_ID_HEADER]: PROFILE_A },
    })
    const body = (await res.json()) as { profileKey: string | null }
    expect(body.profileKey).toBe(PROFILE_A)
  })

  it('falls through with no profile when zero profiles are known', async () => {
    const res = await app().request('/probe')
    const body = (await res.json()) as { profileKey: string | null }
    expect(body.profileKey).toBeNull()
  })

  it(
    'binds the sole known profile for a headerless request — the fix for ' +
      'external MCP clients (Claude Code, browseros-cli, ...) writing ' +
      'soul_edit/user_edit/memory/skills to the wrong (install-root) ' +
      'directory instead of the profile-scoped one the extension reads',
    async () => {
      mkdirSync(join(dir, 'profiles', PROFILE_A), { recursive: true })
      const res = await app().request('/probe')
      const body = (await res.json()) as { profileKey: string | null }
      expect(body.profileKey).toBe(PROFILE_A)
    },
  )

  it('stays profile-less on a headerless request when profiles are ambiguous (2+)', async () => {
    mkdirSync(join(dir, 'profiles', PROFILE_A), { recursive: true })
    mkdirSync(join(dir, 'profiles', PROFILE_B), { recursive: true })
    const res = await app().request('/probe')
    const body = (await res.json()) as { profileKey: string | null }
    expect(body.profileKey).toBeNull()
  })

  it('prefers an explicit header over the implicit single-profile fallback', async () => {
    mkdirSync(join(dir, 'profiles', PROFILE_A), { recursive: true })
    const res = await app().request('/probe', {
      headers: { [BROWSEROS_PROFILE_ID_HEADER]: PROFILE_B },
    })
    const body = (await res.json()) as { profileKey: string | null }
    expect(body.profileKey).toBe(PROFILE_B)
  })
})
