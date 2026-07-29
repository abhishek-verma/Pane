/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createPersonalInternetRoutes } from '../../src/api/routes/personal-internet'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('pi HTTP API', () => {
  let app: Hono
  const dirs: string[] = []

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-api-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    app = new Hono().route('/pi', createPersonalInternetRoutes())
  })

  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  it('creates site, reads site+pages, library, preserve flow', async () => {
    const create = await app.request('/pi/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'job-search' }),
    })
    expect(create.status).toBe(201)
    const created = (await create.json()) as { siteId: string; pageId?: string }
    expect(created.siteId).toBeTruthy()

    const site = await app.request(`/pi/sites/${created.siteId}`)
    expect(site.status).toBe(200)
    const siteBody = (await site.json()) as {
      site: { name: string }
      pages: unknown[]
      pulse: { pulseLine: string } | null
    }
    expect(siteBody.site.name).toBe('Job Search')
    expect(siteBody.pages.length).toBeGreaterThanOrEqual(1)

    if (created.pageId) {
      const page = await app.request(
        `/pi/sites/${created.siteId}/pages/${created.pageId}`,
      )
      expect(page.status).toBe(200)
    }

    const library = await app.request('/pi/library')
    expect(library.status).toBe(200)
    const lib = (await library.json()) as {
      sites: Array<{ pulseLine: string | null }>
    }
    expect(lib.sites.length).toBe(1)
    expect(lib.sites[0]?.pulseLine).toBeTruthy()

    const temp = await app.request('/pi/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'temp',
        title: 'Compare',
        doc: {
          version: 1,
          title: 'Compare',
          nodes: [{ type: 'text', text: 'A vs B' }],
        },
      }),
    })
    expect(temp.status).toBe(201)
    const tempBody = (await temp.json()) as { pageId: string }
    const getTemp = await app.request(`/pi/temps/${tempBody.pageId}`)
    expect(getTemp.status).toBe(200)

    const preserve = await app.request(
      `/pi/temps/${tempBody.pageId}/preserve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'standalone' }),
      },
    )
    expect(preserve.status).toBe(200)

    const host = await app.request('/pi/hooks/host-opened', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'linkedin.com' }),
    })
    expect(host.status).toBe(200)
  })
})
