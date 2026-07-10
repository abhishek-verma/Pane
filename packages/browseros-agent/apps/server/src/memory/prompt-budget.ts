/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Fixed char caps for always-on prompt memory + skill index.
 */

import {
  MEMORY_MAX_CHARS,
  SKILL_INDEX_MAX_CHARS,
  SOUL_MAX_CHARS,
  USER_MAX_CHARS,
} from '@browseros/memory/constants'

export interface BudgetMemoryEntry {
  id: string
  content: string
  usefulness: number
  lastSurfaced: number | null
  createdAt: number
}

export interface PromptBudgetInput {
  soul: string
  user: string
  /** MEMORY.md bullet entries (or whole-file fallback as one entry). */
  memoryEntries: BudgetMemoryEntry[]
  /** Preformatted skill index lines ("- name: description"). */
  skillIndexLines: string[]
}

export interface PromptBudgetResult {
  soulContent: string
  userProfileContent: string
  agentMemoryContent: string
  skillIndexContent: string
  includedMemoryIds: string[]
  evictedMemoryIds: string[]
  truncatedSlots: Array<'soul' | 'user' | 'memory' | 'skill-index'>
}

export class PromptBudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly currentChars: number,
    public readonly maxChars: number,
  ) {
    super(message)
    this.name = 'PromptBudgetExceededError'
  }
}

function hardCap(
  text: string,
  max: number,
  slot: 'soul' | 'user',
  truncatedSlots: PromptBudgetResult['truncatedSlots'],
): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return trimmed
  truncatedSlots.push(slot)
  return trimmed.slice(0, max)
}

function sortForEviction(entries: BudgetMemoryEntry[]): BudgetMemoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.usefulness !== b.usefulness) return a.usefulness - b.usefulness
    const aSurf = a.lastSurfaced ?? a.createdAt
    const bSurf = b.lastSurfaced ?? b.createdAt
    if (aSurf !== bSurf) return aSurf - bSurf
    return a.createdAt - b.createdAt
  })
}

function formatMemoryBody(entries: BudgetMemoryEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map((e) => {
    const body = e.content.trim()
    return body.startsWith('-') ? body : `- ${body}`
  })
  return `# Memory\n\n${lines.join('\n')}`
}

/**
 * Assemble always-on prompt slots under fixed caps.
 * MEMORY evicts lowest usefulness, then oldest last_surfaced.
 * Soul/USER hard-cap with truncation recorded (no silent mid-entry chop without tracking).
 */
export function allocatePromptMemory(
  input: PromptBudgetInput,
): PromptBudgetResult {
  const truncatedSlots: PromptBudgetResult['truncatedSlots'] = []
  const soulContent = hardCap(
    input.soul,
    SOUL_MAX_CHARS,
    'soul',
    truncatedSlots,
  )
  const userProfileContent = hardCap(
    input.user,
    USER_MAX_CHARS,
    'user',
    truncatedSlots,
  )

  const kept = [...input.memoryEntries]
  const evictedMemoryIds: string[] = []
  let agentMemoryContent = formatMemoryBody(kept)
  if (agentMemoryContent.length > MEMORY_MAX_CHARS) {
    truncatedSlots.push('memory')
    const evictionOrder = sortForEviction(kept)
    for (const victim of evictionOrder) {
      if (agentMemoryContent.length <= MEMORY_MAX_CHARS) break
      const idx = kept.findIndex((e) => e.id === victim.id)
      if (idx < 0) continue
      kept.splice(idx, 1)
      evictedMemoryIds.push(victim.id)
      agentMemoryContent = formatMemoryBody(kept)
    }
    // If a single remaining entry still overflows, truncate with tracking.
    if (agentMemoryContent.length > MEMORY_MAX_CHARS && kept.length === 1) {
      agentMemoryContent = agentMemoryContent.slice(0, MEMORY_MAX_CHARS)
    }
  }

  const skillLines = [...input.skillIndexLines]
  let skillIndexContent =
    skillLines.length === 0
      ? ''
      : `<skill_index>\n${skillLines.join('\n')}\n</skill_index>`
  if (skillIndexContent.length > SKILL_INDEX_MAX_CHARS) {
    truncatedSlots.push('skill-index')
    while (
      skillLines.length > 0 &&
      skillIndexContent.length > SKILL_INDEX_MAX_CHARS
    ) {
      skillLines.pop()
      skillIndexContent =
        skillLines.length === 0
          ? ''
          : `<skill_index>\n${skillLines.join('\n')}\n</skill_index>`
    }
  }

  return {
    soulContent,
    userProfileContent,
    agentMemoryContent,
    skillIndexContent,
    includedMemoryIds: kept.map((e) => e.id),
    evictedMemoryIds,
    truncatedSlots,
  }
}

/** Fail loudly when an add would overflow the MEMORY always-on slot. */
export function assertMemoryAddFits(
  currentMemoryChars: number,
  additionChars: number,
  maxChars: number = MEMORY_MAX_CHARS,
): void {
  const next = currentMemoryChars + additionChars + 1 // newline
  if (next > maxChars) {
    throw new PromptBudgetExceededError(
      `Memory add would exceed prompt budget (${next} > ${maxChars}). Consolidate existing entries first.`,
      currentMemoryChars,
      maxChars,
    )
  }
}
