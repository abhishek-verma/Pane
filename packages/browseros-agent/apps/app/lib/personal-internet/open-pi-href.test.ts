/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { canNavigatePiInPlace, openPiHref } from './open-pi-href'

const EXT = 'chrome-extension://biedncddmddkpapdplhcnkhhplnfgbif'
const globals = globalThis as unknown as Record<string, unknown>

afterEach(() => {
  Reflect.deleteProperty(globals, 'chrome')
  Reflect.deleteProperty(globals, 'window')
})

describe('canNavigatePiInPlace', () => {
  test('allows only valid routes already on pi.html', () => {
    expect(canNavigatePiInPlace('/pi.html', '#/pi/library')).toBe(true)
    expect(canNavigatePiInPlace('/pi.html', '#/pi')).toBe(true)
    expect(canNavigatePiInPlace('/app.html', '#/pi/library')).toBe(false)
    expect(canNavigatePiInPlace('/pi.html', '#/home')).toBe(false)
  })
})

describe('openPiHref', () => {
  test('creates a canonical pi:// tab when no matching tab exists', async () => {
    const created: unknown[] = []
    // CI shells sometimes expose window without location — must still use tabs.
    globals.window = {}
    globals.chrome = {
      tabs: {
        query: async () => [],
        create: async (properties: unknown) => {
          created.push(properties)
        },
      },
    }

    await openPiHref('#/pi/sites/site_1')

    expect(created).toEqual([{ url: 'pi://sites/site_1', active: true }])
  })

  test('canonicalizes and focuses an existing internal PI tab', async () => {
    const updates: unknown[] = []
    const focused: unknown[] = []
    globals.chrome = {
      tabs: {
        query: async () => [
          {
            id: 7,
            windowId: 9,
            url: `${EXT}/pi.html#/pi/sites/site_1`,
          },
        ],
        create: async () => {
          throw new Error('must not create a duplicate tab')
        },
        update: async (tabId: number, properties: unknown) => {
          updates.push([tabId, properties])
        },
      },
      windows: {
        update: async (windowId: number, properties: unknown) => {
          focused.push([windowId, properties])
        },
      },
    }

    await openPiHref('pi://sites/site_1')

    expect(updates).toEqual([[7, { url: 'pi://sites/site_1', active: true }]])
    expect(focused).toEqual([[9, { focused: true }]])
  })

  test('migrates a matching legacy NTP PI tab instead of duplicating it', async () => {
    const updates: unknown[] = []
    globals.chrome = {
      tabs: {
        query: async () => [
          {
            id: 8,
            url: 'chrome://newtab/#/pi/sites/site_1',
          },
        ],
        create: async () => {
          throw new Error('must not create a duplicate tab')
        },
        update: async (tabId: number, properties: unknown) => {
          updates.push([tabId, properties])
        },
      },
      windows: {
        update: async () => undefined,
      },
    }

    await openPiHref('pi://sites/site_1')

    expect(updates).toEqual([[8, { url: 'pi://sites/site_1', active: true }]])
  })
})
