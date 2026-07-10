/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type MemoryLayer = 'soul' | 'user' | 'memory' | 'session' | 'activity'

export type MemorySource = 'user' | 'conversation' | 'inferred' | 'migration'

export type MemoryStatus = 'active' | 'staged' | 'demoted' | 'rejected'

export type SkillProvenance =
  | 'agent-written'
  | 'user-written'
  | 'imported'
  | 'migrated'

export type SkillStatus = 'active' | 'staged' | 'archived' | 'flagged'

export interface MemoryEntry {
  id: string
  layer: MemoryLayer
  bucketId: string
  content: string
  source: MemorySource
  status: MemoryStatus
  lastSurfaced: number | null
  usefulness: number
  createdAt: number
  updatedAt: number
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  provenance: SkillProvenance
  sourceRun: string | null
  bucketId: string
  uses: number
  successRate: number | null
  status: SkillStatus
  createdAt: number
  updatedAt: number
}

export interface PromptFiles {
  soul: string
  user: string
  memory: string
}

export interface InjectionScanResult {
  ok: boolean
  reason?: string
}

export interface MemorySqlStatement<T = unknown> {
  all: (...params: unknown[]) => T[]
  get: (...params: unknown[]) => T | null | undefined
  run: (...params: unknown[]) => unknown
}

export interface MemorySqlDatabase {
  prepare: <T = unknown>(sql: string) => MemorySqlStatement<T>
  exec: (sql: string) => void
}
