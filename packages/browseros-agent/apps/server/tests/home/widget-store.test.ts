/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  archiveWidget,
  createWidget,
  getWidget,
  getWidgetsDir,
  listWidgets,
  updateWidgetLastAction,
  updateWidgetShowCount,
} from '../../src/home/widget-store'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('widget-store', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-widgets-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return { widgetsDir: getWidgetsDir(dir) }
  }

  it('createWidget writes SQLite index', async () => {
    const { widgetsDir } = setup()
    const spec = await createWidget(
      {
        title: 'My tasks',
        source: { type: 'tasks', query: 'status:pending' },
        action: { type: 'open-route', target: '#/tasks' },
        refreshMinutes: 5,
        createdBy: 'user',
        whyText: 'User added this.',
      },
      widgetsDir,
    )
    expect(spec.id).toBeTruthy()
    expect(spec.status).toBe('active')
    const fetched = await getWidget(spec.id, widgetsDir)
    expect(fetched?.title).toBe('My tasks')
    expect(fetched?.source.type).toBe('tasks')
    expect(fetched?.source.query).toBe('status:pending')
  })

  it('listWidgets returns only active by default', async () => {
    const { widgetsDir } = setup()
    await createWidget(
      {
        title: 'Active',
        source: { type: 'tasks' },
        action: { type: 'open-route', target: '#/tasks' },
        refreshMinutes: 5,
        createdBy: 'user',
        whyText: '',
      },
      widgetsDir,
    )
    const staged = await createWidget(
      {
        title: 'Staged',
        source: { type: 'scheduled' },
        action: { type: 'open-route', target: '#/scheduled' },
        refreshMinutes: 5,
        createdBy: 'agent',
        whyText: '',
        status: 'staged',
      },
      widgetsDir,
    )
    const active = await listWidgets({ status: 'active' }, widgetsDir)
    expect(active.every((w) => w.status === 'active')).toBe(true)
    const all = await listWidgets({}, widgetsDir)
    expect(all.some((w) => w.id === staged.id)).toBe(true)
  })

  it('archiveWidget sets status to archived', async () => {
    const { widgetsDir } = setup()
    const spec = await createWidget(
      {
        title: 'Bye',
        source: { type: 'tasks' },
        action: { type: 'open-route', target: '#/tasks' },
        refreshMinutes: 5,
        createdBy: 'user',
        whyText: '',
      },
      widgetsDir,
    )
    await archiveWidget(spec.id, widgetsDir)
    const fetched = await getWidget(spec.id, widgetsDir)
    expect(fetched?.status).toBe('archived')
  })

  it('updateWidgetShowCount increments', async () => {
    const { widgetsDir } = setup()
    const spec = await createWidget(
      {
        title: 'Track me',
        source: { type: 'tasks' },
        action: { type: 'open-route', target: '#/tasks' },
        refreshMinutes: 5,
        createdBy: 'user',
        whyText: '',
      },
      widgetsDir,
    )
    await updateWidgetShowCount(spec.id)
    await updateWidgetShowCount(spec.id)
    const row = await getWidget(spec.id, widgetsDir)
    expect(row?.showCount).toBe(2)
  })

  it('updateWidgetLastAction sets timestamp', async () => {
    const { widgetsDir } = setup()
    const spec = await createWidget(
      {
        title: 'Action widget',
        source: { type: 'scheduled' },
        action: { type: 'open-route', target: '#/scheduled' },
        refreshMinutes: 5,
        createdBy: 'user',
        whyText: '',
      },
      widgetsDir,
    )
    expect(spec.lastActionAt).toBeNull()
    await updateWidgetLastAction(spec.id)
    const updated = await getWidget(spec.id, widgetsDir)
    expect(updated?.lastActionAt).not.toBeNull()
  })
})
