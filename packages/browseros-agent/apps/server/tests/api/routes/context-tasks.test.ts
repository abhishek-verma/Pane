/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { createContextRoutes } from '../../../src/api/routes/context'
import { createTasksRoutes } from '../../../src/api/routes/tasks'
import { setGrant } from '../../../src/context/grants'
import { graphUpsertNode } from '../../../src/context/repo'
import { closeDb, initializeDb } from '../../../src/lib/db'

describe('context + tasks API', () => {
  let app: Hono

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-ctx-api-'))
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    app = new Hono()
      .route('/context', createContextRoutes())
      .route('/tasks', createTasksRoutes())
  })

  afterEach(() => {
    closeDb()
  })

  it('search excludes denied domains', async () => {
    graphUpsertNode({
      bucketId: 'default',
      kind: 'page',
      title: 'Evil',
      uri: 'https://evil.com/phish',
      summary: 'evil widgets',
      provenance: 'tool:navigate',
      matchByUri: true,
    })
    graphUpsertNode({
      bucketId: 'default',
      kind: 'page',
      title: 'Good',
      uri: 'https://good.com/docs',
      summary: 'good widgets',
      provenance: 'tool:navigate',
      matchByUri: true,
    })
    setGrant('evil.com', false)

    const res = await app.request('/context/search?q=widgets&bucketId=default')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      snippets: Array<{ uri: string | null }>
    }
    expect(body.snippets.every((s) => !s.uri?.includes('evil.com'))).toBe(true)
  })

  it('task CRUD works', async () => {
    const create = await app.request('/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Fix bug', bucketId: 'default' }),
    })
    expect(create.status).toBe(201)
    const { task } = (await create.json()) as {
      task: { id: string; status: string }
    }
    expect(task.status).toBe('inbox')

    const patch = await app.request(`/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    })
    expect(patch.status).toBe(200)

    const list = await app.request('/tasks?bucketId=default&status=done')
    const listed = (await list.json()) as { tasks: Array<{ id: string }> }
    expect(listed.tasks.some((t) => t.id === task.id)).toBe(true)
  })
})
