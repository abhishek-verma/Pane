/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  MEMORY_MAX_CHARS,
  SKILL_INDEX_MAX_CHARS,
  SOUL_MAX_CHARS,
} from '@browseros/memory/constants'
import { buildSystemPrompt } from '../../src/agent/prompt'
import {
  allocatePromptMemory,
  assertMemoryAddFits,
  PromptBudgetExceededError,
} from '../../src/memory/prompt-budget'

describe('prompt budget allocator', () => {
  it('evicts lowest usefulness MEMORY entries first', () => {
    const big = 'x'.repeat(800)
    const result = allocatePromptMemory({
      soul: 'soul',
      user: 'user',
      memoryEntries: [
        {
          id: 'low',
          content: big,
          usefulness: 0,
          lastSurfaced: 1,
          createdAt: 1,
        },
        {
          id: 'high',
          content: big,
          usefulness: 10,
          lastSurfaced: 1,
          createdAt: 1,
        },
        {
          id: 'mid',
          content: big,
          usefulness: 5,
          lastSurfaced: 1,
          createdAt: 1,
        },
      ],
      skillIndexLines: [],
    })

    expect(result.agentMemoryContent.length).toBeLessThanOrEqual(
      MEMORY_MAX_CHARS,
    )
    expect(result.evictedMemoryIds).toContain('low')
    expect(result.includedMemoryIds).toContain('high')
    expect(result.truncatedSlots).toContain('memory')
  })

  it('keeps soul under cap with truncation recorded', () => {
    const result = allocatePromptMemory({
      soul: 'S'.repeat(SOUL_MAX_CHARS + 200),
      user: 'u',
      memoryEntries: [],
      skillIndexLines: [],
    })
    expect(result.soulContent.length).toBe(SOUL_MAX_CHARS)
    expect(result.truncatedSlots).toContain('soul')
  })

  it('caps skill index without dumping bodies', () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `- skill-${i}: ${'d'.repeat(40)}`,
    )
    const result = allocatePromptMemory({
      soul: '',
      user: '',
      memoryEntries: [],
      skillIndexLines: lines,
    })
    expect(result.skillIndexContent.length).toBeLessThanOrEqual(
      SKILL_INDEX_MAX_CHARS,
    )
    expect(result.skillIndexContent).not.toContain('## Steps')
  })

  it('fails loudly when an add would overflow', () => {
    expect(() => assertMemoryAddFits(MEMORY_MAX_CHARS - 10, 50)).toThrow(
      PromptBudgetExceededError,
    )
  })
})

describe('prompt memory sections', () => {
  it('includes user profile, agent memory, and skill index slots', () => {
    const prompt = buildSystemPrompt({
      soulContent: 'Be terse.',
      userProfileContent: 'Name: Ada',
      agentMemoryContent: '# Memory\n\n- prefers tabs',
      skillIndexContent: '- export-report: Export the weekly CSV',
    })
    expect(prompt).toContain('<soul>')
    expect(prompt).toContain('Be terse.')
    expect(prompt).toContain('<user_profile>')
    expect(prompt).toContain('Name: Ada')
    expect(prompt).toContain('<agent_memory>')
    expect(prompt).toContain('prefers tabs')
    expect(prompt).toContain('<skill_index>')
    expect(prompt).toContain('export-report')
  })
})
