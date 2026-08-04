/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * One-time claim of pre-profile (install-wide) user data into the first
 * Chrome profile that connects after upgrade.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import { getInstallBrowserosDir } from './browseros-dir'
import { logger } from './logger'

const LEGACY_USER_DATA_DIRS = [
  PATHS.DB_DIR_NAME,
  PATHS.MEMORIES_DIR_NAME,
  PATHS.CAPTURE_DIR_NAME,
  PATHS.SESSIONS_DIR_NAME,
  PATHS.TOOL_OUTPUT_DIR_NAME,
] as const

const CLAIM_MARKER = '.profile-legacy-claimed'

let claimAttempted = false

function hasLegacyUserData(installDir: string): boolean {
  return LEGACY_USER_DATA_DIRS.some((name) =>
    existsSync(join(installDir, name)),
  )
}

function alreadyClaimed(installDir: string): boolean {
  return existsSync(join(installDir, PATHS.PROFILES_DIR_NAME, CLAIM_MARKER))
}

/** True when any profile directory has already been created under `profiles/`. */
function hasOtherProfiles(profilesRoot: string): boolean {
  if (!existsSync(profilesRoot)) return false
  return readdirSync(profilesRoot).some((entry) => !entry.startsWith('.'))
}

/**
 * If install-wide user-data dirs still exist at the BrowserOS root, move them
 * into `profiles/<profileKey>/` for the first caller. Later profiles start empty.
 */
export function claimLegacyProfileData(profileKey: string): void {
  if (claimAttempted) return
  claimAttempted = true

  const installDir = getInstallBrowserosDir()
  if (alreadyClaimed(installDir) || !hasLegacyUserData(installDir)) {
    return
  }

  const profilesRoot = join(installDir, PATHS.PROFILES_DIR_NAME)
  if (hasOtherProfiles(profilesRoot)) {
    // Legacy data reappearing at the install root after other profiles
    // already exist is not the single-profile upgrade case this claim
    // exists for (e.g. a caller dropped the profile header and wrote here
    // by mistake). Never hand that data to an unrelated profile.
    logger.warn('Skipped legacy profile claim: other profiles already exist', {
      profileKey,
    })
    return
  }

  const profileDir = join(profilesRoot, profileKey)
  mkdirSync(profileDir, { recursive: true })

  for (const name of LEGACY_USER_DATA_DIRS) {
    const src = join(installDir, name)
    const dest = join(profileDir, name)
    if (!existsSync(src)) continue
    if (existsSync(dest)) {
      logger.warn('Legacy profile claim skipped existing destination', {
        profileKey,
        name,
      })
      continue
    }
    try {
      renameSync(src, dest)
      logger.info('Claimed legacy profile data', { profileKey, name })
    } catch (err) {
      logger.error('Failed to claim legacy profile data', {
        profileKey,
        name,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  mkdirSync(profilesRoot, { recursive: true })
  try {
    writeFileSync(
      join(profilesRoot, CLAIM_MARKER),
      `${profileKey}\n${Date.now()}\n`,
      { flag: 'wx' },
    )
  } catch (err) {
    // Another process may have claimed concurrently after we checked.
    logger.warn('Legacy claim marker already present', {
      profileKey,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Test helper: allow claim to run again in the next test case. */
export function resetLegacyClaimForTests(): void {
  claimAttempted = false
}
