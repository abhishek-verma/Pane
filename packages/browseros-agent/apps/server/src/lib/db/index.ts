/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getDbPath, getProfileDbPath } from '../browseros-dir'
import { tryGetProfileKey } from '../profile-context'
import {
  type BrowserOsDatabase,
  type DbHandle,
  type OpenDbOptions,
  openBrowserOsDatabase,
} from './client'

let openOptions: OpenDbOptions = {}
/** Explicit path from tests / legacy single-DB boot (no profile context). */
let explicitHandle: DbHandle | null = null
const profileHandles = new Map<string, DbHandle>()

/**
 * Configures (and optionally opens) the BrowserOS database.
 * - With `dbPath`: opens immediately as the unbound/explicit handle (tests).
 * - Without `dbPath`: stores options for lazy per-profile open.
 */
export function initializeDb(options: OpenDbOptions = {}): DbHandle | null {
  openOptions = options
  if (options.dbPath) {
    const dbPath = options.dbPath
    // Always (re)open the explicit path so parallel/sequential tests do not
    // reuse a stale handle from a previous temp directory.
    if (explicitHandle) {
      explicitHandle.sqlite.close()
      explicitHandle = null
    }
    for (const handle of profileHandles.values()) {
      handle.sqlite.close()
    }
    profileHandles.clear()
    mkdirSync(dirname(dbPath), { recursive: true })
    explicitHandle = openBrowserOsDatabase({ ...options, dbPath })
    return explicitHandle
  }
  return null
}

/** Opens (or returns) the DB handle for a Chrome profile key. */
export function getOrOpenProfileDb(profileKey: string): DbHandle {
  const existing = profileHandles.get(profileKey)
  if (existing) return existing

  const dbPath = getProfileDbPath(profileKey)
  mkdirSync(dirname(dbPath), { recursive: true })
  const handle = openBrowserOsDatabase({
    ...openOptions,
    dbPath,
  })
  profileHandles.set(profileKey, handle)
  return handle
}

export function getDbHandle(): DbHandle {
  const profileKey = tryGetProfileKey()
  if (profileKey) {
    return getOrOpenProfileDb(profileKey)
  }
  if (explicitHandle) {
    return explicitHandle
  }
  // Lazy open at install-root path when no profile context (boot jobs before
  // first profile, or code that still uses getDbPath() without ALS).
  const dbPath = openOptions.dbPath ?? getDbPath()
  mkdirSync(dirname(dbPath), { recursive: true })
  explicitHandle = openBrowserOsDatabase({
    ...openOptions,
    dbPath,
  })
  return explicitHandle
}

export function getDb(): BrowserOsDatabase {
  return getDbHandle().db
}

/** Returns currently open profile DB keys. */
export function listOpenProfileKeys(): string[] {
  return [...profileHandles.keys()]
}

export function closeDb(): void {
  if (explicitHandle) {
    explicitHandle.sqlite.close()
    explicitHandle = null
  }
  for (const handle of profileHandles.values()) {
    handle.sqlite.close()
  }
  profileHandles.clear()
}

export type { BrowserOsDatabase, DbHandle, OpenDbOptions }
