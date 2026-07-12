/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Tool-level tests for home widget tools (home_widget_list, home_widget_propose,
 * home_widget_add, home_widget_remove) and the homeLoaderCalledChat guard.
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHomeWidgetToolSet } from '../../src/home/tools'
import { getWidgetsDir, listWidgets } from '../../src/home/widget-store'
import { closeDb, initializeDb } from '../../src/lib/db'

type AnyResult = Record<string, unknown>

async function callTool(
  // biome-ignore lint/suspicious/noExplicitAny: generic tool call
  tool: { execute?: (...args: any[]) => Promise<unknown> },
  args: Record<string, unknown>,
): Promise<AnyResult> {
  const result = await tool.execute?.(args, {
    toolCallId: 'test',
    messages: [],
  })
  return (result ?? {}) as AnyResult
}

describe('home widget tools', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    delete process.env.BROWSEROS_DIR
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-widget-tools-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    process.env.BROWSEROS_DIR = dir
    const widgetsDir = getWidgetsDir(dir)
    return { dir, widgetsDir }
  }

  it('home_widget_list returns empty widgets and available templates on fresh install', async () => {
    setup()
    const tools = buildHomeWidgetToolSet()
    const result = await callTool(tools.home_widget_list, {})
    expect(Array.isArray(result.widgets)).toBe(true)
    expect((result.widgets as unknown[]).length).toBe(0)
    expect(Array.isArray(result.availableTemplates)).toBe(true)
    expect((result.availableTemplates as unknown[]).length).toBeGreaterThan(0)
  })

  it('home_widget_propose returns a draft without writing to disk', async () => {
    const { widgetsDir } = setup()
    const tools = buildHomeWidgetToolSet()
    const result = await callTool(tools.home_widget_propose, {
      userIntent: 'show my open tasks',
      title: 'My open tasks',
      source: { type: 'tasks', query: 'status:pending' },
      action: { type: 'open-route', target: '#/tasks' },
      whyText: 'Shows pending tasks',
      refreshMinutes: 5,
    })
    expect(result.confirmationRequired).toBe(true)
    expect(typeof result.message).toBe('string')
    expect(result.message as string).toContain('confirm')
    expect(result.proposed).toBe(true)
    // Must NOT have been written yet
    const widgets = await listWidgets({ status: 'active' }, widgetsDir)
    expect(widgets).toHaveLength(0)
  })

  it('home_widget_add writes the widget and it appears via home_widget_list', async () => {
    const { widgetsDir } = setup()
    const tools = buildHomeWidgetToolSet()

    const addResult = await callTool(tools.home_widget_add, {
      title: 'Pending approvals',
      source: { type: 'tasks', query: 'type:approval' },
      action: { type: 'open-route', target: '#/tasks' },
      whyText: 'Shows awaiting approvals',
      refreshMinutes: 1,
      createdBy: 'user',
    })
    expect(addResult.added).toBe(true)
    const widget = addResult.widget as {
      status: string
      id: string
      title: string
    }
    expect(widget.status).toBe('active')

    // Should now appear in list
    const listResult = await callTool(tools.home_widget_list, {})
    const widgets = listResult.widgets as Array<{ title: string }>
    expect(widgets).toHaveLength(1)
    expect(widgets[0].title).toBe('Pending approvals')

    // File SoT: also in widgetsDir
    const stored = await listWidgets({ status: 'active' }, widgetsDir)
    expect(stored).toHaveLength(1)
  })

  it('home_widget_remove archives the widget and removes it from the active list', async () => {
    const { widgetsDir } = setup()
    const tools = buildHomeWidgetToolSet()

    const addResult = await callTool(tools.home_widget_add, {
      title: 'Research thread',
      source: { type: 'capture', query: 'bucket:research' },
      action: { type: 'open-route', target: '#/capture' },
      whyText: 'Active research',
      refreshMinutes: 10,
      createdBy: 'agent',
    })
    const widgetId = (addResult.widget as { id: string }).id

    await callTool(tools.home_widget_remove, { id: widgetId })

    // Active list is now empty
    const active = await listWidgets({ status: 'active' }, widgetsDir)
    expect(active).toHaveLength(0)

    // Archived list has it
    const archived = await listWidgets({ status: 'archived' }, widgetsDir)
    expect(archived).toHaveLength(1)
    expect(archived[0].id).toBe(widgetId)
  })

  it('propose → add → list integration: full round-trip', async () => {
    setup()
    const tools = buildHomeWidgetToolSet()

    // 1. Propose
    const proposed = await callTool(tools.home_widget_propose, {
      userIntent: 'track upcoming scheduled runs',
      title: 'Next scheduled run',
      source: { type: 'scheduled' },
      action: { type: 'open-route', target: '#/scheduled' },
      whyText: 'Your upcoming runs',
      refreshMinutes: 5,
    })
    expect(proposed.confirmationRequired).toBe(true)
    const draft = proposed.draft as Record<string, unknown>

    // 2. Add (simulating user confirmation)
    const added = await callTool(tools.home_widget_add, {
      ...draft,
      createdBy: 'agent',
    })
    expect(added.added).toBe(true)

    // 3. Verify appears on home list
    const listed = await callTool(tools.home_widget_list, {})
    const listedWidgets = listed.widgets as Array<{ title: string }>
    expect(listedWidgets.some((w) => w.title === 'Next scheduled run')).toBe(
      true,
    )
  })
})
