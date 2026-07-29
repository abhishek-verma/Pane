/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import { deriveClass } from '@browseros/shared/trust/consequence-class'
import { filterToolsForChatMode } from '../../src/agent/chat-mode'
import { closeDb, initializeDb } from '../../src/lib/db'
import { buildPersonalInternetToolSet } from '../../src/personal-internet/tools'

const ctx: GateContext = {
  pins: {},
  runConsequentialCount: { count: 0 },
  isNewUser: false,
  surface: 'loop',
}

async function callTool(
  tool: { execute?: (...args: unknown[]) => Promise<unknown> },
  args: Record<string, unknown>,
) {
  const result = await tool.execute!(args, { toolCallId: 't', messages: [] })
  return result as { text: string; isError?: boolean }
}

describe('pi tools + trust', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-tools-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('classifies read / write-local correctly', () => {
    expect(deriveClass('pi_list', {}, ctx)).toBe('read')
    expect(deriveClass('pi_read', {}, ctx)).toBe('read')
    expect(deriveClass('pi_pulse_get', {}, ctx)).toBe('read')
    expect(deriveClass('pi_site_upsert', {}, ctx)).toBe('write-local')
    expect(deriveClass('pi_page_create', {}, ctx)).toBe('write-local')
    expect(deriveClass('pi_page_patch', {}, ctx)).toBe('write-local')
    expect(deriveClass('pi_page_delete', {}, ctx)).toBe('write-local')
    expect(deriveClass('pi_site_archive', {}, ctx)).toBe('write-local')
    expect(deriveClass('pi_preserve_temp', {}, ctx)).toBe('write-local')
    expect(deriveClass('pi_home_regions_patch', {}, ctx)).toBe('write-local')
    expect(deriveClass('pi_site_upsert', {}, ctx)).not.toBe('write-external')
  })

  it('chat mode keeps read pi_* and drops writes', () => {
    const tools = buildPersonalInternetToolSet()
    const filtered = filterToolsForChatMode(tools)
    expect(filtered.pi_list).toBeTruthy()
    expect(filtered.pi_read).toBeTruthy()
    expect(filtered.pi_pulse_get).toBeTruthy()
    expect(filtered.pi_site_upsert).toBeUndefined()
    expect(filtered.pi_page_create).toBeUndefined()
  })

  it('site upsert + read roundtrip', async () => {
    setup()
    const tools = buildPersonalInternetToolSet()
    const created = await callTool(tools.pi_site_upsert, {
      templateId: 'job-search',
    })
    expect(created.isError).toBeFalsy()
    const body = JSON.parse(created.text) as {
      siteId: string
      route: string
    }
    expect(body.siteId).toBeTruthy()
    expect(body.route).toContain('#/pi/sites/')

    const listed = await callTool(tools.pi_list, {})
    const listBody = JSON.parse(listed.text) as {
      sites: Array<{ id: string }>
    }
    expect(listBody.sites.some((s) => s.id === body.siteId)).toBe(true)

    const read = await callTool(tools.pi_read, { siteId: body.siteId })
    expect(read.isError).toBeFalsy()
  })
})
