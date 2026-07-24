/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Request-scoped Chrome browser profile identity for per-profile data roots.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ProfileStore {
  profileKey: string
}

const als = new AsyncLocalStorage<ProfileStore>()

/** Returns true when the value is a UUID suitable as a profile key. */
export function isValidProfileKey(value: string): boolean {
  return UUID_RE.test(value)
}

/** Runs `fn` with the given Chrome profile key bound for path/DB helpers. */
export function runWithProfile<T>(profileKey: string, fn: () => T): T {
  if (!isValidProfileKey(profileKey)) {
    throw new Error(`Invalid profile key: ${profileKey}`)
  }
  return als.run({ profileKey }, fn)
}

/** Like runWithProfile but for async work. */
export async function runWithProfileAsync<T>(
  profileKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isValidProfileKey(profileKey)) {
    throw new Error(`Invalid profile key: ${profileKey}`)
  }
  return als.run({ profileKey }, fn)
}

/** Returns the active profile key, or null when none is bound. */
export function tryGetProfileKey(): string | null {
  return als.getStore()?.profileKey ?? null
}

/** Returns the active profile key or throws. */
export function getRequiredProfileKey(): string {
  const key = tryGetProfileKey()
  if (!key) {
    throw new Error('Profile context required but not set')
  }
  return key
}
