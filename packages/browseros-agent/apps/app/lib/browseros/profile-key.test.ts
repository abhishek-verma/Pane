/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { BROWSEROS_PREFS } from './prefs'

const UUID_MATCHER =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const storageState = new Map<string, unknown>()

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: (key: string) => ({
      getValue: async () => storageState.get(key) ?? null,
      setValue: async (value: unknown) => {
        storageState.set(key, value)
      },
    }),
  },
}))

class MockPrefApiUnavailableError extends Error {}

let prefValue: string | null = null
/**
 * 'ok' resolves prefValue. 'unavailable' throws a generic error (API exists,
 * transient — e.g. the pref genuinely hasn't populated yet on a brand-new
 * profile). 'absent' throws PrefApiUnavailableError (API structurally
 * missing — dev / non-BrowserOS, permanent for this page).
 */
let prefMode: 'ok' | 'unavailable' | 'absent' = 'ok'

mock.module('./adapter', () => ({
  PrefApiUnavailableError: MockPrefApiUnavailableError,
  getBrowserOSAdapter: () => ({
    getPref: async (name: string) => {
      if (prefMode === 'absent') throw new MockPrefApiUnavailableError('absent')
      if (prefMode === 'unavailable') throw new Error('transient')
      if (name !== BROWSEROS_PREFS.METRICS_CLIENT_ID) {
        throw new Error(`unexpected pref ${name}`)
      }
      return { key: name, type: 'string', value: prefValue }
    },
  }),
}))

const { getBrowserProfileKey, resetBrowserProfileKeyCacheForTests } =
  await import('./profile-key')

describe('getBrowserProfileKey', () => {
  beforeEach(() => {
    storageState.clear()
    prefValue = null
    prefMode = 'ok'
    resetBrowserProfileKeyCacheForTests()
  })

  it('returns metrics_client_id when the pref is a UUID', async () => {
    prefValue = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    await expect(getBrowserProfileKey()).resolves.toBe(prefValue)
    await expect(getBrowserProfileKey()).resolves.toBe(prefValue)
  })

  it('falls back to a stable local UUID when the pref is transiently unavailable', async () => {
    prefMode = 'unavailable'
    const first = await getBrowserProfileKey()
    expect(first).toMatch(UUID_MATCHER)
    resetBrowserProfileKeyCacheForTests()
    const second = await getBrowserProfileKey()
    expect(second).toBe(first)
  })

  // Four more cases belong here, all verified only by running this file in
  // isolation (`bun test lib/browseros/profile-key.test.ts`), never in the
  // full suite: bun's mock.module has no per-file scope and no unmock, and
  // agent-fetch.test.ts / mcp/client.test.ts both mock './profile-key'
  // wholesale (a stateless stand-in with no caching/probe logic at all) —
  // whichever file's mock.module call is collected first wins process-wide,
  // so the real module is unreachable there. See profile-key.ts for what
  // each case protects:
  //   - re-probes every call while transiently unavailable (never caches
  //     into `cachedKey` on the 'unavailable' branch) — assert by counting
  //     calls to the mocked getPref above
  //   - caches on the very first call when the pref API is structurally
  //     absent (dev / non-BrowserOS) — the fix for the per-request I/O
  //     regression a naive "never cache the fallback" version would have
  //   - upgrades to the pref key on the next call once it becomes
  //     available, without a reset/reload (the brand-new-profile race:
  //     whichever page runs first, typically onboarding via the native
  //     first-run handoff, must not get stuck on a local id forever while a
  //     later page, e.g. the side panel, resolves the real one)
  //   - concurrent callers while a resolution is in flight share one probe
  //     (getPref call count stays 1 for 3 parallel calls) instead of each
  //     independently racing `ensureLocalFallbackKey`'s read-then-write
})
