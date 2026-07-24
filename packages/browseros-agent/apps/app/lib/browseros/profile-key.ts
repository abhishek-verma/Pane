/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Resolves a stable per-Chrome-profile key for agent-server data isolation.
 * Prefers the browser-owned metrics client id; falls back to a UUID in
 * chrome.storage.local when the pref is unavailable (dev / non-BrowserOS).
 */

import { storage } from '@wxt-dev/storage'
import { getBrowserOSAdapter } from './adapter'
import { BROWSEROS_PREFS } from './prefs'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const browserProfileKeyStorage = storage.defineItem<string | null>(
  'local:browserProfileKey',
  { fallback: null },
)

let cachedKey: string | null = null

function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

async function readMetricsClientId(): Promise<string | null> {
  try {
    const adapter = getBrowserOSAdapter()
    const pref = await adapter.getPref(BROWSEROS_PREFS.METRICS_CLIENT_ID)
    if (typeof pref?.value === 'string' && isUuid(pref.value)) {
      return pref.value
    }
  } catch {
    // Pref API unavailable outside BrowserOS.
  }
  return null
}

async function ensureLocalFallbackKey(): Promise<string> {
  const existing = await browserProfileKeyStorage.getValue()
  if (existing && isUuid(existing)) {
    return existing
  }
  const generated = crypto.randomUUID()
  await browserProfileKeyStorage.setValue(generated)
  return generated
}

/** Returns a stable UUID identifying the current Chrome browser profile. */
export async function getBrowserProfileKey(): Promise<string> {
  if (cachedKey) return cachedKey

  const fromPref = await readMetricsClientId()
  if (fromPref) {
    cachedKey = fromPref
    return fromPref
  }

  const fallback = await ensureLocalFallbackKey()
  cachedKey = fallback
  return fallback
}

/** Test helper: clear the in-memory cache between cases. */
export function resetBrowserProfileKeyCacheForTests(): void {
  cachedKey = null
}
