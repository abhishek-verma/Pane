/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { eq } from 'drizzle-orm'
import { getDb } from '../lib/db'
import {
  type TriggerRuleRow,
  triggerRules,
} from '../lib/db/schema/trigger-rules'
import {
  type CreateTriggerRuleInput,
  DEFAULT_TRIGGER_COOLDOWN_MS,
  type TriggerMatch,
  type TriggerRule,
} from './types'

function newId(): string {
  return `trg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

function parseMatch(json: string): TriggerMatch {
  try {
    return JSON.parse(json) as TriggerMatch
  } catch {
    return {}
  }
}

function rowToRule(row: TriggerRuleRow): TriggerRule {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    match: parseMatch(row.matchJson),
    prompt: row.prompt,
    jobId: row.jobId,
    bucketId: row.bucketId,
    cooldownMs: row.cooldownMs,
    lastFiredAt: row.lastFiredAt,
    matchCount: row.matchCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function listTriggerRules(): TriggerRule[] {
  return getDb().select().from(triggerRules).all().map(rowToRule)
}

export function getTriggerRule(id: string): TriggerRule | null {
  const row = getDb()
    .select()
    .from(triggerRules)
    .where(eq(triggerRules.id, id))
    .get()
  return row ? rowToRule(row) : null
}

export function createTriggerRule(input: CreateTriggerRuleInput): TriggerRule {
  const now = Date.now()
  const id = input.id ?? newId()
  const row: TriggerRuleRow = {
    id,
    name: input.name,
    enabled: input.enabled ?? true,
    matchJson: JSON.stringify(input.match),
    prompt: input.prompt,
    jobId: input.jobId ?? null,
    bucketId: input.bucketId ?? 'default',
    cooldownMs: input.cooldownMs ?? DEFAULT_TRIGGER_COOLDOWN_MS,
    lastFiredAt: null,
    matchCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(triggerRules).values(row).run()
  return rowToRule(row)
}

export function updateTriggerRule(
  id: string,
  patch: Partial<
    Pick<
      TriggerRule,
      | 'name'
      | 'enabled'
      | 'match'
      | 'prompt'
      | 'jobId'
      | 'bucketId'
      | 'cooldownMs'
    >
  >,
): TriggerRule | null {
  const existing = getTriggerRule(id)
  if (!existing) return null
  const now = Date.now()
  const next: TriggerRuleRow = {
    id,
    name: patch.name ?? existing.name,
    enabled: patch.enabled ?? existing.enabled,
    matchJson: JSON.stringify(patch.match ?? existing.match),
    prompt: patch.prompt ?? existing.prompt,
    jobId: patch.jobId !== undefined ? (patch.jobId ?? null) : existing.jobId,
    bucketId: patch.bucketId ?? existing.bucketId,
    cooldownMs: patch.cooldownMs ?? existing.cooldownMs,
    lastFiredAt: existing.lastFiredAt,
    matchCount: existing.matchCount,
    createdAt: existing.createdAt,
    updatedAt: now,
  }
  getDb()
    .update(triggerRules)
    .set({
      name: next.name,
      enabled: next.enabled,
      matchJson: next.matchJson,
      prompt: next.prompt,
      jobId: next.jobId,
      bucketId: next.bucketId,
      cooldownMs: next.cooldownMs,
      updatedAt: now,
    })
    .where(eq(triggerRules.id, id))
    .run()
  return rowToRule(next)
}

export function deleteTriggerRule(id: string): boolean {
  const result = getDb()
    .delete(triggerRules)
    .where(eq(triggerRules.id, id))
    .run()
  return result.changes > 0
}

export function recordTriggerMatch(id: string): TriggerRule | null {
  const existing = getTriggerRule(id)
  if (!existing) return null
  const now = Date.now()
  const matchCount = existing.matchCount + 1
  getDb()
    .update(triggerRules)
    .set({ matchCount, updatedAt: now })
    .where(eq(triggerRules.id, id))
    .run()
  return { ...existing, matchCount, updatedAt: now }
}

export function recordTriggerFire(id: string): TriggerRule | null {
  const existing = getTriggerRule(id)
  if (!existing) return null
  const now = Date.now()
  getDb()
    .update(triggerRules)
    .set({ lastFiredAt: now, updatedAt: now })
    .where(eq(triggerRules.id, id))
    .run()
  return { ...existing, lastFiredAt: now, updatedAt: now }
}
