/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { deriveMaterializeActivity } from '../../src/agent/materialize-activity'

describe('deriveMaterializeActivity', () => {
  it('returns newest lines and detects waiting tool', () => {
    const snap = deriveMaterializeActivity(
      [
        {
          role: 'assistant',
          parts: [
            { type: 'reasoning', text: 'Plan structure pass for GitLab' },
            {
              type: 'tool-skills_load',
              state: 'output-available',
              input: { id: 'pi-page-patch' },
            },
            {
              type: 'tool-pi_page_patch',
              state: 'input-available',
              input: { pageId: 'page_1' },
            },
          ],
        },
      ],
      4,
    )
    expect(snap.toolWaiting).toBe(true)
    expect(snap.lastToolName).toBe('pi_page_patch')
    expect(snap.lines.at(-1)?.text).toContain('Waiting')
    expect(snap.lines.some((l) => l.text.includes('pi-page-patch'))).toBe(true)
  })

  it('recognizes an ACP-namespaced tool name (mcp__browseros__ prefix)', () => {
    const snap = deriveMaterializeActivity(
      [
        {
          role: 'assistant',
          parts: [
            {
              type: 'tool-mcp__browseros__pi_read',
              state: 'output-available',
              input: {},
            },
          ],
        },
      ],
      4,
    )
    expect(snap.lastToolName).toBe('pi_read')
    expect(snap.lines.at(-1)?.text).toBe('Reading page…')
  })
})
