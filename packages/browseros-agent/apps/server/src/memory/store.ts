/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * SQLite index for memory_entries + skills. Rebuildable from files.
 */

import { randomUUID } from 'node:crypto'
import {
  DEFAULT_BUCKET_ID,
  ENTRY_MAX_CHARS,
  MEMORY_FILE,
  SOUL_FILE,
  USER_FILE,
} from '@browseros/memory/constants'
import { assertMemoryContent } from '@browseros/memory/scan'
import type {
  MemoryEntry,
  MemoryLayer,
  MemorySource,
  MemoryStatus,
  SkillProvenance,
  SkillRecord,
  SkillStatus,
} from '@browseros/memory/types'
import { getDbHandle } from '../lib/db'
import {
  appendMemoryFileLine,
  listSkillIdsOnDisk,
  readPromptFiles,
  readSkillFile,
  removeMemoryFileLine,
  seedPromptFilesIfMissing,
  writeSkillFile,
} from './files'

export { MemoryWriteRejectedError } from '@browseros/memory/scan'

function now(): number {
  return Date.now()
}

function sqlite() {
  return getDbHandle().sqlite
}

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  return {
    id: String(row.id),
    layer: row.layer as MemoryLayer,
    bucketId: String(row.bucket_id),
    content: String(row.content),
    source: row.source as MemorySource,
    status: row.status as MemoryStatus,
    lastSurfaced: row.last_surfaced == null ? null : Number(row.last_surfaced),
    usefulness: Number(row.usefulness ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function rowToSkill(row: Record<string, unknown>): SkillRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    provenance: row.provenance as SkillProvenance,
    sourceRun: row.source_run == null ? null : String(row.source_run),
    bucketId: String(row.bucket_id),
    uses: Number(row.uses ?? 0),
    successRate: row.success_rate == null ? null : Number(row.success_rate),
    status: row.status as SkillStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export interface WriteMemoryEntryInput {
  content: string
  layer?: MemoryLayer
  bucketId?: string
  source?: MemorySource
  status?: MemoryStatus
  /** When true (default for conversation/user), also append to MEMORY.md. */
  syncFile?: boolean
  /** Override memories root (tests). */
  memoriesRoot?: string
}

export async function writeMemoryEntry(
  input: WriteMemoryEntryInput,
): Promise<MemoryEntry> {
  const content = input.content.trim().slice(0, ENTRY_MAX_CHARS)
  assertMemoryContent(content)

  const layer = input.layer ?? 'memory'
  const bucketId = input.bucketId ?? DEFAULT_BUCKET_ID
  const source = input.source ?? 'user'
  const status =
    input.status ??
    (source === 'inferred' ? 'staged' : ('active' as MemoryStatus))
  const syncFile = input.syncFile ?? (layer === 'memory' && status === 'active')

  if (syncFile) {
    await appendMemoryFileLine(content, input.memoriesRoot)
  }

  const ts = now()
  const id = randomUUID()
  sqlite()
    .prepare(
      `INSERT INTO memory_entries (
        id, layer, bucket_id, content, source, status,
        last_surfaced, usefulness, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
    )
    .run(id, layer, bucketId, content, source, status, ts, ts)

  return {
    id,
    layer,
    bucketId,
    content,
    source,
    status,
    lastSurfaced: null,
    usefulness: 0,
    createdAt: ts,
    updatedAt: ts,
  }
}

export async function forgetMemoryEntry(
  substring: string,
  options: { bucketId?: string; memoriesRoot?: string } = {},
): Promise<{ removed: boolean; entryIds: string[] }> {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  const removedFile = await removeMemoryFileLine(
    substring,
    options.memoriesRoot,
  )
  const rows = sqlite()
    .prepare(
      `SELECT id FROM memory_entries
       WHERE bucket_id = ? AND status IN ('active', 'demoted', 'staged')
         AND instr(lower(content), lower(?)) > 0`,
    )
    .all(bucketId, substring.trim()) as Array<{ id: string }>

  const entryIds = rows.map((r) => r.id)
  for (const id of entryIds) {
    sqlite()
      .prepare(
        `UPDATE memory_entries SET status = 'rejected', updated_at = ? WHERE id = ?`,
      )
      .run(now(), id)
  }
  return { removed: removedFile || entryIds.length > 0, entryIds }
}

export interface ListEntriesOptions {
  bucketId?: string
  layer?: MemoryLayer
  status?: MemoryStatus | MemoryStatus[]
  query?: string
  limit?: number
}

export function listEntries(options: ListEntriesOptions = {}): MemoryEntry[] {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const statuses = options.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : (['active', 'demoted', 'staged'] as MemoryStatus[])

  const params: Array<string | number> = [bucketId]
  let sql = `SELECT * FROM memory_entries WHERE bucket_id = ?`
  if (options.layer) {
    sql += ` AND layer = ?`
    params.push(options.layer)
  }
  sql += ` AND status IN (${statuses.map(() => '?').join(',')})`
  params.push(...statuses)
  if (options.query?.trim()) {
    sql += ` AND instr(lower(content), lower(?)) > 0`
    params.push(options.query.trim())
  }
  sql += ` ORDER BY usefulness DESC, updated_at DESC LIMIT ?`
  params.push(limit)

  const rows = sqlite()
    .prepare(sql)
    .all(...params) as Array<Record<string, unknown>>
  return rows.map(rowToEntry)
}

export function bumpSurfaced(ids: string[], usefulnessDelta = 1): void {
  if (ids.length === 0) return
  const ts = now()
  const stmt = sqlite().prepare(
    `UPDATE memory_entries
     SET last_surfaced = ?, usefulness = usefulness + ?, updated_at = ?
     WHERE id = ?`,
  )
  for (const id of ids) {
    stmt.run(ts, usefulnessDelta, ts, id)
  }
}

export function demoteEntry(id: string): void {
  sqlite()
    .prepare(
      `UPDATE memory_entries SET status = 'demoted', updated_at = ? WHERE id = ?`,
    )
    .run(now(), id)
}

/** Wipe index rows for prompt layers and rebuild from files. Skills rebuilt from disk. */
export async function rebuildIndexFromFiles(
  memoriesRoot?: string,
): Promise<{ entries: number; skills: number }> {
  await seedPromptFilesIfMissing(memoriesRoot)
  const files = await readPromptFiles(memoriesRoot)
  const ts = now()
  const db = sqlite()

  db.prepare(
    `DELETE FROM memory_entries WHERE layer IN ('soul', 'user', 'memory')`,
  ).run()

  const insert = db.prepare(
    `INSERT INTO memory_entries (
      id, layer, bucket_id, content, source, status,
      last_surfaced, usefulness, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'migration', 'active', NULL, 0, ?, ?)`,
  )

  const upsertLayer = (layer: MemoryLayer, content: string, label: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    // Index as one row per file for soul/user; MEMORY.md split into bullets.
    if (layer === 'memory') {
      const lines = trimmed
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-'))
      if (lines.length === 0) {
        insert.run(randomUUID(), layer, DEFAULT_BUCKET_ID, trimmed, ts, ts)
        return
      }
      for (const line of lines) {
        const body = line.replace(/^-+\s*/, '').trim()
        if (!body) continue
        try {
          assertMemoryContent(body)
        } catch {
          continue
        }
        insert.run(
          randomUUID(),
          layer,
          DEFAULT_BUCKET_ID,
          body.slice(0, ENTRY_MAX_CHARS),
          ts,
          ts,
        )
      }
      return
    }
    insert.run(
      randomUUID(),
      layer,
      DEFAULT_BUCKET_ID,
      trimmed.slice(0, ENTRY_MAX_CHARS),
      ts,
      ts,
    )
    void label
  }

  upsertLayer('soul', files.soul, SOUL_FILE)
  upsertLayer('user', files.user, USER_FILE)
  upsertLayer('memory', files.memory, MEMORY_FILE)

  // Skills: keep rows that still have files; drop orphaned active rows without files.
  const diskIds = await listSkillIdsOnDisk(memoriesRoot)
  const diskSet = new Set(diskIds)
  const existing = db
    .prepare(`SELECT id FROM skills WHERE status = 'active'`)
    .all() as Array<{ id: string }>
  for (const row of existing) {
    if (!diskSet.has(row.id)) {
      db.prepare(
        `UPDATE skills SET status = 'archived', updated_at = ? WHERE id = ?`,
      ).run(ts, row.id)
    }
  }

  let skillCount = 0
  for (const id of diskIds) {
    const body = (await readSkillFile(id, memoriesRoot)) ?? ''
    const { name, description } = parseSkillFrontmatter(body, id)
    const found = db.prepare(`SELECT id FROM skills WHERE id = ?`).get(id) as {
      id: string
    } | null
    if (found) {
      db.prepare(
        `UPDATE skills SET name = ?, description = ?, status = 'active', updated_at = ? WHERE id = ?`,
      ).run(name, description, ts, id)
    } else {
      db.prepare(
        `INSERT INTO skills (
          id, name, description, provenance, source_run, bucket_id,
          uses, success_rate, status, created_at, updated_at
        ) VALUES (?, ?, ?, 'migrated', NULL, ?, 0, NULL, 'active', ?, ?)`,
      ).run(id, name, description, DEFAULT_BUCKET_ID, ts, ts)
    }
    skillCount++
  }

  const entryCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM memory_entries WHERE layer IN ('soul','user','memory')`,
      )
      .get() as { c: number }
  ).c

  return { entries: entryCount, skills: skillCount }
}

export function parseSkillFrontmatter(
  body: string,
  fallbackId: string,
): { name: string; description: string } {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    return {
      name: fallbackId,
      description:
        body
          .split('\n')
          .find((l) => l.trim())
          ?.trim() ?? fallbackId,
    }
  }
  const block = match[1] ?? ''
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? fallbackId
  const description =
    block.match(/^description:\s*(.+)$/m)?.[1]?.trim() ??
    body
      .slice(match[0].length)
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ??
    name
  return { name, description }
}

export function upsertSkillRecord(input: {
  id: string
  name: string
  description: string
  provenance: SkillProvenance
  sourceRun?: string | null
  bucketId?: string
  status?: SkillStatus
}): SkillRecord {
  const ts = now()
  const bucketId = input.bucketId ?? DEFAULT_BUCKET_ID
  const status = input.status ?? 'active'
  const existing = sqlite()
    .prepare(`SELECT * FROM skills WHERE id = ?`)
    .get(input.id) as Record<string, unknown> | null

  if (existing) {
    sqlite()
      .prepare(
        `UPDATE skills SET name = ?, description = ?, provenance = ?,
         source_run = ?, bucket_id = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.description,
        input.provenance,
        input.sourceRun ?? null,
        bucketId,
        status,
        ts,
        input.id,
      )
    return rowToSkill({
      ...existing,
      name: input.name,
      description: input.description,
      provenance: input.provenance,
      source_run: input.sourceRun ?? null,
      bucket_id: bucketId,
      status,
      updated_at: ts,
    })
  }

  sqlite()
    .prepare(
      `INSERT INTO skills (
        id, name, description, provenance, source_run, bucket_id,
        uses, success_rate, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.name,
      input.description,
      input.provenance,
      input.sourceRun ?? null,
      bucketId,
      status,
      ts,
      ts,
    )

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    provenance: input.provenance,
    sourceRun: input.sourceRun ?? null,
    bucketId,
    uses: 0,
    successRate: null,
    status,
    createdAt: ts,
    updatedAt: ts,
  }
}

export function listSkills(
  options: {
    bucketId?: string
    status?: SkillStatus | SkillStatus[]
    limit?: number
  } = {},
): SkillRecord[] {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200)
  const statuses = options.status
    ? Array.isArray(options.status)
      ? options.status
      : [options.status]
    : (['active', 'staged'] as SkillStatus[])

  const params: Array<string | number> = [bucketId, ...statuses, limit]
  const rows = sqlite()
    .prepare(
      `SELECT * FROM skills
       WHERE bucket_id = ?
         AND status IN (${statuses.map(() => '?').join(',')})
       ORDER BY name ASC
       LIMIT ?`,
    )
    .all(...params) as Array<Record<string, unknown>>
  return rows.map(rowToSkill)
}

export function getSkill(id: string): SkillRecord | null {
  const row = sqlite()
    .prepare(`SELECT * FROM skills WHERE id = ?`)
    .get(id) as Record<string, unknown> | null
  return row ? rowToSkill(row) : null
}

export async function installSkillFromBody(input: {
  id: string
  body: string
  provenance: SkillProvenance
  bucketId?: string
  memoriesRoot?: string
}): Promise<SkillRecord> {
  assertMemoryContent(input.body)
  const { name, description } = parseSkillFrontmatter(input.body, input.id)
  await writeSkillFile(input.id, input.body, input.memoriesRoot)
  return upsertSkillRecord({
    id: input.id,
    name,
    description,
    provenance: input.provenance,
    bucketId: input.bucketId,
    status: 'active',
  })
}

export function incrementSkillUses(id: string): void {
  sqlite()
    .prepare(`UPDATE skills SET uses = uses + 1, updated_at = ? WHERE id = ?`)
    .run(now(), id)
}

/**
 * Rolling success rate for a skill (EMA). Call after a run that loaded the
 * skill finishes (success) or aborts/errors (failure).
 */
export function recordSkillOutcome(id: string, success: boolean): void {
  const skill = getSkill(id)
  if (!skill) return
  const alpha = 0.3
  const sample = success ? 1 : 0
  const next =
    skill.successRate == null
      ? sample
      : skill.successRate * (1 - alpha) + sample * alpha
  sqlite()
    .prepare(`UPDATE skills SET success_rate = ?, updated_at = ? WHERE id = ?`)
    .run(next, now(), id)
}

export function setSkillStatus(id: string, status: SkillStatus): void {
  sqlite()
    .prepare(`UPDATE skills SET status = ?, updated_at = ? WHERE id = ?`)
    .run(status, now(), id)
}
