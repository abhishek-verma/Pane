/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Helpers to run background work once per known Chrome profile data root.
 */

import { listKnownProfileKeys } from './browseros-dir'
import { listOpenProfileKeys } from './db'
import { isValidProfileKey, runWithProfileAsync } from './profile-context'

/** Profile keys that exist on disk or already have an open DB handle. */
export async function listActiveProfileKeys(): Promise<string[]> {
  const fromDisk = await listKnownProfileKeys()
  const open = listOpenProfileKeys()
  const keys = new Set<string>()
  for (const key of [...fromDisk, ...open]) {
    if (isValidProfileKey(key)) keys.add(key)
  }
  return [...keys]
}

/** Runs `fn` under each known profile context. */
export async function forEachKnownProfile(
  fn: (profileKey: string) => Promise<void> | void,
): Promise<void> {
  const keys = await listActiveProfileKeys()
  for (const key of keys) {
    await runWithProfileAsync(key, async () => {
      await fn(key)
    })
  }
}
