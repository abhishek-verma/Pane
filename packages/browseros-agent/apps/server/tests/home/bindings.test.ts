/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeBinding } from '../../src/home/bindings'
import {
  getCachedBinding,
  getOrComputeBinding,
  setCachedBinding,
} from '../../src/home/widget-cache'
import type { WidgetSpec } from '../../src/home/widget-spec'
import { closeDb, initializeDb } from '../../src/lib/db'

function makeSpec(overrides: Partial<WidgetSpec> = {}): WidgetSpec {
  return {
    id: 'test-1',
    title: 'Test widget',
    source: { type: 'tasks', query: 'status:pending' },
    action: { type: 'open-route', target: '#/tasks' },
    refreshMinutes: 5,
    createdBy: 'user',
    status: 'active',
    showCount: 0,
    lastActionAt: null,
    whyText: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('bindings', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'bos-bind-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('tasks binding returns items array from DB', async () => {
    setup()
    const spec = makeSpec({
      source: { type: 'tasks', query: 'status:pending' },
    })
    const result = await executeBinding(spec)
    expect(result).toHaveProperty('items')
    expect(Array.isArray(result.items)).toBe(true)
    expect(typeof result.count).toBe('number')
  })

  it('scheduled binding returns next pending run or empty', async () => {
    setup()
    const spec = makeSpec({ source: { type: 'scheduled' } })
    const result = await executeBinding(spec)
    expect(result.items.length).toBeLessThanOrEqual(1)
  })

  it('skills binding filters by query pattern', async () => {
    setup()
    const spec = makeSpec({ source: { type: 'skills', query: 'weekly' } })
    const result = await executeBinding(spec)
    expect(Array.isArray(result.items)).toBe(true)
  })

  it('unknown source type returns empty gracefully', async () => {
    setup()
    const spec = makeSpec({
      source: { type: 'template', templateId: 'nonexistent' },
    })
    const result = await executeBinding(spec)
    expect(result.items.length).toBe(0)
  })
})

describe('widget-cache', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'bos-cache-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('setCachedBinding and getCachedBinding round-trip', () => {
    setup()
    const result = { items: [{ label: 'Test item' }], count: 1 }
    setCachedBinding('widget-1', result)
    const cached = getCachedBinding('widget-1')
    expect(cached).toEqual(result)
  })

  it('getCachedBinding returns null for expired entries', () => {
    setup()
    const result = { items: [], count: 0 }
    setCachedBinding('widget-2', result, -1000) // expired 1 second ago
    const cached = getCachedBinding('widget-2')
    expect(cached).toBeNull()
  })

  it('getOrComputeBinding uses cache on second call', async () => {
    setup()
    let computeCount = 0
    const spec = makeSpec({ id: 'cache-test' })
    const compute = async () => {
      computeCount++
      return { items: [], count: 0 }
    }
    await getOrComputeBinding(spec, compute)
    await getOrComputeBinding(spec, compute)
    expect(computeCount).toBe(1)
  })
})
