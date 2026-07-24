/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { PATHS } from '@browseros/shared/constants/paths'
import {
  getBrowserosDir,
  getDbPath,
  getMemoriesDir,
  getProfileDbPath,
} from '../../src/lib/browseros-dir'
import { closeDb, getDb, initializeDb } from '../../src/lib/db'
import { chatSessions } from '../../src/lib/db/schema/chat-sessions'
import {
  isValidProfileKey,
  runWithProfile,
  runWithProfileAsync,
  tryGetProfileKey,
} from '../../src/lib/profile-context'
import {
  claimLegacyProfileData,
  resetLegacyClaimForTests,
} from '../../src/lib/profile-legacy-migrate'

const PROFILE_A = '11111111-1111-4111-8111-111111111111'
const PROFILE_B = '22222222-2222-4222-8222-222222222222'

describe('profile context', () => {
  it('validates UUID profile keys', () => {
    expect(isValidProfileKey(PROFILE_A)).toBe(true)
    expect(isValidProfileKey('Default')).toBe(false)
    expect(isValidProfileKey('')).toBe(false)
  })

  it('binds ALS for the active profile', () => {
    expect(tryGetProfileKey()).toBeNull()
    runWithProfile(PROFILE_A, () => {
      expect(tryGetProfileKey()).toBe(PROFILE_A)
    })
    expect(tryGetProfileKey()).toBeNull()
  })
})

describe('per-profile data roots and DB isolation', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'browseros-profile-iso-'))
    process.env.BROWSEROS_DIR = dir
    resetLegacyClaimForTests()
    closeDb()
    initializeDb({ resourcesDir: undefined })
  })

  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    resetLegacyClaimForTests()
  })

  it('resolves distinct db and memories paths per profile', () => {
    runWithProfile(PROFILE_A, () => {
      expect(getBrowserosDir()).toBe(
        join(dir, PATHS.PROFILES_DIR_NAME, PROFILE_A),
      )
      expect(getDbPath()).toBe(getProfileDbPath(PROFILE_A))
      expect(getMemoriesDir()).toBe(
        join(dir, PATHS.PROFILES_DIR_NAME, PROFILE_A, PATHS.MEMORIES_DIR_NAME),
      )
    })
    runWithProfile(PROFILE_B, () => {
      expect(getDbPath()).toBe(getProfileDbPath(PROFILE_B))
    })
    expect(getProfileDbPath(PROFILE_A)).not.toBe(getProfileDbPath(PROFILE_B))
  })

  it('isolates chat_sessions rows across profiles', async () => {
    await runWithProfileAsync(PROFILE_A, async () => {
      const db = getDb()
      db.insert(chatSessions)
        .values({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          createdAt: 1,
          updatedAt: 1,
        })
        .run()
    })

    await runWithProfileAsync(PROFILE_B, async () => {
      const db = getDb()
      db.insert(chatSessions)
        .values({
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          createdAt: 2,
          updatedAt: 2,
        })
        .run()
      const rows = db.select().from(chatSessions).all()
      expect(rows.map((r) => r.id)).toEqual([
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ])
    })

    await runWithProfileAsync(PROFILE_A, async () => {
      const rows = getDb().select().from(chatSessions).all()
      expect(rows.map((r) => r.id)).toEqual([
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ])
    })

    expect(existsSync(getProfileDbPath(PROFILE_A))).toBe(true)
    expect(existsSync(getProfileDbPath(PROFILE_B))).toBe(true)
  })

  it('claims legacy install-wide data into the first profile only', () => {
    mkdirSync(join(dir, PATHS.DB_DIR_NAME), { recursive: true })
    writeFileSync(join(dir, PATHS.DB_DIR_NAME, PATHS.DB_FILE_NAME), 'legacy')
    mkdirSync(join(dir, PATHS.MEMORIES_DIR_NAME), { recursive: true })
    writeFileSync(join(dir, PATHS.MEMORIES_DIR_NAME, 'SOUL.md'), 'soul')

    claimLegacyProfileData(PROFILE_A)

    expect(
      existsSync(
        join(dir, PATHS.PROFILES_DIR_NAME, PROFILE_A, PATHS.DB_DIR_NAME),
      ),
    ).toBe(true)
    expect(existsSync(join(dir, PATHS.DB_DIR_NAME))).toBe(false)
    expect(
      existsSync(
        join(
          dir,
          PATHS.PROFILES_DIR_NAME,
          PROFILE_A,
          PATHS.MEMORIES_DIR_NAME,
          'SOUL.md',
        ),
      ),
    ).toBe(true)

    mkdirSync(join(dir, PATHS.DB_DIR_NAME), { recursive: true })
    writeFileSync(join(dir, PATHS.DB_DIR_NAME, 'stray.sqlite'), 'nope')
    claimLegacyProfileData(PROFILE_B)
    // Marker already present — second claim is a no-op for B.
    expect(
      existsSync(
        join(dir, PATHS.PROFILES_DIR_NAME, PROFILE_B, PATHS.DB_DIR_NAME),
      ),
    ).toBe(false)
  })
})

describe('profile header constant', () => {
  it('exports the expected header name', () => {
    expect(BROWSEROS_PROFILE_ID_HEADER).toBe('X-BrowserOS-Profile-Id')
  })
})
