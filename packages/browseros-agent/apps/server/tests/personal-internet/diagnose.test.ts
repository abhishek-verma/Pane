/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  buildPageDiagnosis,
  describePageRender,
  tryAutoRepairPage,
} from '../../src/personal-internet/diagnose'
import type { PiNode } from '../../src/personal-internet/types'

describe('diagnose / auto-repair', () => {
  it('auto-repairs agent-shaped boards', () => {
    const raw = {
      version: 1,
      title: 'GTM',
      nodes: [
        {
          type: 'board',
          columns: [{ id: 'todo', title: 'To Do' }],
          cards: [
            { columnId: 'todo', title: 'Register domain', description: 'x' },
          ],
        },
      ],
    }
    const repaired = tryAutoRepairPage(raw, 'GTM')
    expect(repaired).not.toBeNull()
    if (!repaired) throw new Error('expected repair')
    expect(repaired.doc.nodes[0]?.type).toBe('board')
    const board = repaired.doc.nodes[0]
    if (board?.type === 'board') {
      expect(board.columns[0]?.cardIds).toHaveLength(1)
      expect(board.cards[0]?.subtitle).toBe('x')
    }
  })

  it('builds agentBrief with tool steps, not raw dump', () => {
    const diagnosis = buildPageDiagnosis({
      pageId: 'page_1',
      issues: ['nodes[0]: mermaid source required'],
      raw: {
        version: 1,
        title: 'X',
        nodes: [{ type: 'mermaid', source: '' }],
      },
      fallbackTitle: 'X',
    })
    expect(diagnosis.autoFixedDoc).not.toBeNull()
    expect(diagnosis.agentBrief).toContain('auto')
    expect(
      diagnosis.findings.some(
        (f) => f.code === 'mermaid_invalid' && f.severity === 'auto_fixed',
      ),
    ).toBe(true)
  })

  it('marks invalid JSON as needs_agent with replaceNodes steps', () => {
    const diagnosis = buildPageDiagnosis({
      pageId: 'page_1',
      issues: ['Invalid JSON: Unexpected token'],
      raw: null,
    })
    const finding = diagnosis.findings.find((f) => f.code === 'invalid_json')
    expect(finding?.severity).toBe('needs_agent')
    expect(finding?.agentSteps.join(' ')).toContain('replaceNodes')
    expect(diagnosis.needsRaw).toBe(true)
  })
})

describe('describePageRender', () => {
  it('describes an empty page distinctly', () => {
    const rendered = describePageRender({ title: 'Empty', nodes: [] })
    expect(rendered).toContain('Empty')
    expect(rendered).toContain('empty')
  })

  it('describes headings, markdown paragraphs, tables, and boards in order', () => {
    const nodes: PiNode[] = [
      { type: 'title', text: 'Job Search' },
      { type: 'text', text: 'Tracking **12** active applications.' },
      {
        type: 'table',
        columns: [{ id: 'c1', header: 'Company' }],
        rows: [{ id: 'r1', cells: { c1: 'Acme' } }],
      },
      {
        type: 'board',
        columns: [
          { id: 'todo', title: 'To Do', cardIds: ['c1'] },
          { id: 'done', title: 'Done', cardIds: [] },
        ],
        cards: [{ id: 'c1', title: 'Register domain' }],
      },
    ]
    const rendered = describePageRender({ title: 'Job Search', nodes })

    const headingIdx = rendered.indexOf('Heading: "Job Search"')
    const paraIdx = rendered.indexOf('Paragraph: "Tracking **12** active')
    const tableIdx = rendered.indexOf('Table [Company] — 1 row(s)')
    const boardIdx = rendered.indexOf(
      'Board — columns: To Do (1), Done (0); 1 card(s) total',
    )

    expect(headingIdx).toBeGreaterThan(-1)
    expect(paraIdx).toBeGreaterThan(headingIdx)
    expect(tableIdx).toBeGreaterThan(paraIdx)
    expect(boardIdx).toBeGreaterThan(tableIdx)
  })

  it('describes a stat node', () => {
    const nodes: PiNode[] = [
      { type: 'stat', label: 'Active applications', value: '12' },
    ]
    const rendered = describePageRender({ title: 'Pipeline', nodes })
    expect(rendered).toContain('Stat: Active applications = 12')
  })

  it('flags an empty board so the agent notices before telling the user it is ready', () => {
    const nodes: PiNode[] = [
      {
        type: 'board',
        columns: [{ id: 'todo', title: 'To Do', cardIds: [] }],
        cards: [],
      },
    ]
    const rendered = describePageRender({ title: 'New board', nodes })
    expect(rendered).toContain('0 card(s) total')
  })

  it('describes a multi-column stack distinctly from a plain row group', () => {
    const nodes: PiNode[] = [
      {
        type: 'stack',
        columns: 2,
        children: [
          { type: 'text', text: 'Left' },
          { type: 'text', text: 'Right' },
        ],
      },
    ]
    const rendered = describePageRender({ title: 'Layout', nodes })
    expect(rendered).toContain('2-column section:')
  })

  it('indents stack children under their group', () => {
    const nodes: PiNode[] = [
      {
        type: 'stack',
        direction: 'col',
        children: [{ type: 'note', text: 'Nested callout' }],
      },
    ]
    const rendered = describePageRender({ title: 'Grouped', nodes })
    const lines = rendered.split('\n')
    const groupLine = lines.findIndex((l) => l.includes('Section:'))
    expect(groupLine).toBeGreaterThan(-1)
    expect(lines[groupLine + 1]).toContain('Callout: "Nested callout"')
    expect(lines[groupLine + 1]?.startsWith('  ')).toBe(true)
  })
})
