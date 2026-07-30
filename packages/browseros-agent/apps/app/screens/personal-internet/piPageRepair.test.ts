/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { buildPiPageRepairAction } from './piPageRepair'

describe('buildPiPageRepairAction', () => {
  it('prefers diagnosis brief and tells agent not to parse raw validators', () => {
    const action = buildPiPageRepairAction({
      siteId: 'site_1',
      pageId: 'page_1',
      pageTitle: 'GTM',
      agentBrief:
        '1. [board_shape] Wrong card shape\n   Approach: use upsertBoardCard\n   - pi_page_patch',
      findings: [
        {
          code: 'board_shape',
          severity: 'needs_agent',
          summary: 'Wrong card shape',
          suggestedApproach: 'use upsertBoardCard',
          agentSteps: ['pi_page_patch'],
        },
      ],
      contentSummary: {
        title: 'GTM',
        nodeTypes: ['board'],
        boardSummaries: [
          {
            columns: ['To Do'],
            cardTitles: ['Register domain'],
            shape: 'agent_shaped',
          },
        ],
      },
      renderError: 'Cannot read properties of undefined',
    })
    expect(action.query).toContain('Do NOT reverse-engineer raw validator')
    expect(action.query).toContain('upsertBoardCard')
    expect(action.query).toContain('diagnosis.needsRaw')
    expect(action.query).toContain('Content summary')
    expect(action.metadata.intent).toBe('pi-page-repair')
  })
})
