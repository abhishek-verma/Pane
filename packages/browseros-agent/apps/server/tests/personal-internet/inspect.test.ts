/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectPageFile } from '../../src/personal-internet/inspect'

describe('inspectPageFile', () => {
  it('coerces agent-shaped boards and records a coerce warning', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-inspect-'))
    const filePath = join(dir, 'page.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        title: 'Broken Board',
        nodes: [
          {
            type: 'board',
            columns: [{ id: 'todo', title: 'To Do' }],
            cards: [
              {
                columnId: 'todo',
                title: 'Task',
                description: 'desc',
              },
            ],
          },
        ],
      }),
    )
    const result = await inspectPageFile({
      pageId: 'page_x',
      siteId: 'site_x',
      title: 'Broken Board',
      filePath,
    })
    expect(result.ok).toBe(true)
    expect(result.doc?.nodes[0]?.type).toBe('board')
    expect(result.issues.some((i) => /Coerced on read/i.test(i))).toBe(true)
  })

  it('auto-repairs empty mermaid and returns ok doc', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-inspect-'))
    const filePath = join(dir, 'page.json')
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        title: 'Bad',
        nodes: [{ type: 'mermaid', source: '' }],
      }),
    )
    const result = await inspectPageFile({
      pageId: 'page_y',
      siteId: 'site_y',
      title: 'Bad',
      filePath,
    })
    expect(result.ok).toBe(true)
    expect(result.doc).toBeTruthy()
    expect(result.diagnosis.autoFixesApplied.length).toBeGreaterThan(0)
    expect(result.diagnosis.agentBrief.length).toBeGreaterThan(0)
  })

  it('reports invalid JSON parse errors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-inspect-'))
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, 'page.json')
    writeFileSync(filePath, '{not-json')
    const result = await inspectPageFile({
      pageId: 'page_z',
      siteId: null,
      title: 'x',
      filePath,
    })
    expect(result.ok).toBe(false)
    expect(result.issues[0]).toMatch(/Invalid JSON/)
  })
})
