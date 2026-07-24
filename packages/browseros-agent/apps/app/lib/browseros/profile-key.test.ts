/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { BROWSEROS_PREFS } from './prefs'

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

let prefValue: string | null = null
let prefThrows = false

mock.module('./adapter', () => ({
  getBrowserOSAdapter: () => ({
    getPref: async (name: string) => {
      if (prefThrows) throw new Error('unavailable')
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
    prefThrows = false
    resetBrowserProfileKeyCacheForTests()
  })

  it('returns metrics_client_id when the pref is a UUID', async () => {
    prefValue = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    await expect(getBrowserProfileKey()).resolves.toBe(prefValue)
    await expect(getBrowserProfileKey()).resolves.toBe(prefValue)
  })

  it('falls back to a stable local UUID when the pref is missing', async () => {
    prefThrows = true
    const first = await getBrowserProfileKey()
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    resetBrowserProfileKeyCacheForTests()
    const second = await getBrowserProfileKey()
    expect(second).toBe(first)
  })
})
