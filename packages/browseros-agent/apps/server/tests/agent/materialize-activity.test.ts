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
})
