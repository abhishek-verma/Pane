/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  buildPageDiagnosis,
  tryAutoRepairPage,
} from '../../src/personal-internet/diagnose'

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
