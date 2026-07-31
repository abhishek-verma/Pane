/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { PI_LIMITS } from '@browseros/shared/constants/limits'
import {
  assertMermaidSourceBudget,
  countMermaidEdges,
  hasForbiddenMermaidDirective,
} from './mermaid-limits'

describe('mermaid-limits', () => {
  it('counts edges', () => {
    expect(countMermaidEdges('flowchart LR\nA-->B\nB-->C\nC---D')).toBe(3)
  })

  it('rejects oversize source', () => {
    expect(() =>
      assertMermaidSourceBudget('x'.repeat(PI_LIMITS.MAX_MERMAID_CHARS + 1)),
    ).toThrow(/exceeds/)
  })

  it('rejects init directives that override limits', () => {
    const source =
      '%%{init: {"flowchart": {"maxEdges": 99999}}}%%\nflowchart LR\nA-->B'
    expect(hasForbiddenMermaidDirective(source)).toBe(true)
    expect(() => assertMermaidSourceBudget(source)).toThrow(/init directives/)
  })

  it('allows ordinary diagrams', () => {
    expect(() =>
      assertMermaidSourceBudget('flowchart LR\nA-->B\nB-->C'),
    ).not.toThrow()
  })

  it('rejects too many edges', () => {
    const edges = Array.from(
      { length: PI_LIMITS.MAX_MERMAID_EDGES + 1 },
      (_, i) => `N${i}-->N${i + 1}`,
    ).join('\n')
    expect(() => assertMermaidSourceBudget(`flowchart LR\n${edges}`)).toThrow(
      /edges/,
    )
  })
})
