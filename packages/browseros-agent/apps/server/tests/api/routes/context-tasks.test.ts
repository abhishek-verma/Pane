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

  it('lists nodes by kind with pagination', async () => {
    for (let i = 0; i < 3; i++) {
      graphUpsertNode({
        bucketId: 'default',
        kind: 'file',
        title: `note-${i}.txt`,
        uri: `/tmp/note-${i}.txt`,
        provenance: 'tool:filesystem_write',
        matchByUri: true,
      })
    }

    const page1 = await app.request(
      '/context/nodes?bucketId=default&kind=file&limit=2&offset=0',
    )
    expect(page1.status).toBe(200)
    const body1 = (await page1.json()) as {
      nodes: Array<{ id: string }>
      hasMore: boolean
    }
    expect(body1.nodes.length).toBe(2)
    expect(body1.hasMore).toBe(true)

    const page2 = await app.request(
      '/context/nodes?bucketId=default&kind=file&limit=2&offset=2',
    )
    const body2 = (await page2.json()) as {
      nodes: Array<{ id: string }>
      hasMore: boolean
    }
    expect(body2.nodes.length).toBe(1)
    expect(body2.hasMore).toBe(false)
  })

  it('rejects an invalid kind for node listing', async () => {
    const res = await app.request(
      '/context/nodes?bucketId=default&kind=not-a-real-kind',
    )
    expect(res.status).toBe(400)
  })

  it('bulk deletes nodes', async () => {
    const a = graphUpsertNode({
      bucketId: 'default',
      kind: 'page',
      title: 'To delete A',
      uri: 'https://del-a.example/',
      provenance: 'tool:navigate',
      matchByUri: true,
    })
    const b = graphUpsertNode({
      bucketId: 'default',
      kind: 'page',
      title: 'To delete B',
      uri: 'https://del-b.example/',
      provenance: 'tool:navigate',
      matchByUri: true,
    })

    const del = await app.request('/context/nodes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [a.id, b.id] }),
    })
    expect(del.status).toBe(200)
    const delBody = (await del.json()) as { deleted: number }
    expect(delBody.deleted).toBe(2)

    const after = await app.request(
      '/context/nodes?bucketId=default&kind=page&limit=10&offset=0',
    )
    const afterBody = (await after.json()) as { nodes: Array<{ id: string }> }
    expect(afterBody.nodes.some((n) => n.id === a.id)).toBe(false)
    expect(afterBody.nodes.some((n) => n.id === b.id)).toBe(false)
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
