/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  DEFAULT_BUCKET_ID,
  DIGESTS_DIR,
  MEMORY_MAX_CHARS,
} from '@browseros/memory/constants'
import {
  assertMemoryContent,
  MemoryWriteRejectedError,
} from '@browseros/memory/scan'
import { assertSkillFetchUrlAllowed } from '@browseros/memory/skill-url'
import type { SkillProvenance } from '@browseros/memory/types'
import { logger } from '../lib/logger'
import {
  deleteSkillFiles,
  ensureMemoriesLayout,
  memoriesRoot,
  readSkillFile,
  writeSkillFile,
} from './files'
import { assertMemoryAddFits } from './prompt-budget'
import {
  deleteSkillRecord,
  demoteEntry,
  getSkill,
  getSkillByIdOrName,
  incrementSkillUses,
  installSkillFromBody,
  listEntries,
  listSkills,
  parseSkillFrontmatter,
  setSkillStatus,
  upsertSkillRecord,
} from './store'

const UNUSED_SKILL_DAYS = 30
const LOW_SUCCESS_THRESHOLD = 0.4
const LOW_SUCCESS_MIN_USES = 5
const UNRECALLED_MEMORY_DAYS = 30
const SKILL_FETCH_MAX_REDIRECTS = 3

/** Built-in skill ids all use this prefix (see memory/builtin-skills.ts). */
const BUILTIN_SKILL_ID_PREFIX = 'builtin-'

function isBuiltinSkillId(id: string): boolean {
  return id.startsWith(BUILTIN_SKILL_ID_PREFIX)
}

export class SkillNotDeletableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillNotDeletableError'
  }
}

/**
 * Permanently remove a non-built-in skill (files + DB row). Built-in skills
 * are reseeded on every startup (ensureBuiltinSkills) and can only be
 * archived, never deleted.
 */
export async function removeSkill(
  id: string,
  options: { memoriesRoot?: string } = {},
): Promise<void> {
  if (isBuiltinSkillId(id)) {
    throw new SkillNotDeletableError(
      `"${id}" is a built-in skill and can't be deleted — archive it instead.`,
    )
  }
  await deleteSkillFiles(id, options.memoriesRoot)
  deleteSkillRecord(id)
}

/** Author and install a new skill from a full SKILL.md body (agent- or user-written). */
export async function installSkillFromAuthoredBody(
  body: string,
  options: {
    id?: string
    provenance?: Extract<SkillProvenance, 'agent-written' | 'user-written'>
    bucketId?: string
    memoriesRoot?: string
  } = {},
): Promise<string> {
  const parsed = parseSkillFrontmatter(body, 'agent-skill')
  const id =
    options.id?.trim() ||
    parsed.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  if (isBuiltinSkillId(id)) {
    throw new SkillFetchError(
      `Skill id "${id}" is reserved for built-in skills — choose a different id or name.`,
    )
  }
  await installSkillFromBody({
    id,
    body,
    provenance: options.provenance ?? 'agent-written',
    bucketId: options.bucketId ?? DEFAULT_BUCKET_ID,
    memoriesRoot: options.memoriesRoot,
  })
  return id
}

/**
 * Activates any skill still sitting in the (removed) staging gate — a
 * one-time migration for installs upgrading from before self-authored
 * skills went live immediately. No-op once nothing is staged.
 */
export async function activateAllStagedSkills(
  memoriesRootPath?: string,
): Promise<string[]> {
  const pending = listSkills({ status: 'staged', limit: 200 })
  const activated: string[] = []
  for (const skill of pending) {
    const result = await activateStagedSkill(skill.id, {
      memoriesRoot: memoriesRootPath,
    })
    if (result.ok) activated.push(skill.id)
  }
  return activated
}

export async function activateStagedSkill(
  id: string,
  options: { memoriesRoot?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  const skill = getSkill(id)
  if (skill?.status !== 'staged') {
    return { ok: false, error: `No staged skill: ${id}` }
  }
  const base = memoriesRoot(options.memoriesRoot)
  const stagedPath = join(base, 'staging', `${id}.md`)
  let body: string
  try {
    body = await readFile(stagedPath, 'utf-8')
  } catch {
    return { ok: false, error: `Staged file missing: ${id}` }
  }
  try {
    assertMemoryContent(body)
  } catch (err) {
    const reason =
      err instanceof MemoryWriteRejectedError ? err.reason : String(err)
    return { ok: false, error: `Staged skill failed scan: ${reason}` }
  }
  await writeSkillFile(id, body, options.memoriesRoot)
  const { name, description } = parseSkillFrontmatter(body, id)
  upsertSkillRecord({
    id,
    name,
    description,
    provenance: skill.provenance,
    sourceRun: skill.sourceRun,
    bucketId: skill.bucketId,
    status: 'active',
  })
  await rm(stagedPath, { force: true }).catch(() => {})
  return { ok: true }
}

export async function rejectStagedSkill(
  id: string,
  options: { memoriesRoot?: string } = {},
): Promise<void> {
  setSkillStatus(id, 'archived')
  const base = memoriesRoot(options.memoriesRoot)
  await rm(join(base, 'staging', `${id}.md`), { force: true }).catch(() => {})
}

export async function archiveSkill(id: string): Promise<void> {
  setSkillStatus(id, 'archived')
}

export async function loadSkillBody(
  idOrName: string,
  options: { memoriesRoot?: string } = {},
): Promise<string | null> {
  const loaded = await loadSkill(idOrName, options)
  return loaded?.body ?? null
}

/** Load skill body and resolved id (accepts id or name). */
export async function loadSkill(
  idOrName: string,
  options: { memoriesRoot?: string } = {},
): Promise<{ id: string; body: string } | null> {
  const skill = getSkillByIdOrName(idOrName)
  if (!skill || skill.status === 'archived') return null
  const body = await readSkillFile(skill.id, options.memoriesRoot)
  if (!body) return null
  incrementSkillUses(skill.id)
  return { id: skill.id, body }
}

export interface CurationResult {
  archivedSkills: string[]
  flaggedSkills: string[]
  demotedMemory: string[]
  digestPath: string | null
}

export async function runCurationPass(
  options: { now?: number; memoriesRoot?: string; writeDigest?: boolean } = {},
): Promise<CurationResult> {
  const now = options.now ?? Date.now()
  const archivedSkills: string[] = []
  const flaggedSkills: string[] = []
  const demotedMemory: string[] = []

  const skills = listSkills({
    status: ['active', 'flagged'],
    limit: 200,
  })
  for (const skill of skills) {
    const ageMs = now - skill.createdAt
    if (skill.uses === 0 && ageMs >= UNUSED_SKILL_DAYS * 24 * 60 * 60 * 1000) {
      setSkillStatus(skill.id, 'archived')
      archivedSkills.push(skill.id)
      continue
    }
    if (
      skill.uses >= LOW_SUCCESS_MIN_USES &&
      skill.successRate != null &&
      skill.successRate < LOW_SUCCESS_THRESHOLD
    ) {
      if (skill.status === 'flagged') {
        setSkillStatus(skill.id, 'archived')
        archivedSkills.push(skill.id)
      } else {
        setSkillStatus(skill.id, 'flagged')
        flaggedSkills.push(skill.id)
      }
    }
  }

  const memories = listEntries({
    layer: 'memory',
    status: 'active',
    limit: 200,
  })
  const unrecalledCutoff = now - UNRECALLED_MEMORY_DAYS * 24 * 60 * 60 * 1000
  for (const entry of memories) {
    const last = entry.lastSurfaced ?? entry.createdAt
    if (last < unrecalledCutoff) {
      demoteEntry(entry.id)
      demotedMemory.push(entry.id)
    }
  }

  let digestPath: string | null = null
  if (options.writeDigest !== false) {
    const base = await ensureMemoriesLayout(options.memoriesRoot)
    const d = new Date(now)
    const stamp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    digestPath = join(base, DIGESTS_DIR, `curation-${stamp}.md`)
    const body = `# Curation digest ${stamp}

- Archived skills: ${archivedSkills.length}${archivedSkills.length ? ` (${archivedSkills.join(', ')})` : ''}
- Flagged skills: ${flaggedSkills.length}${flaggedSkills.length ? ` (${flaggedSkills.join(', ')})` : ''}
- Demoted memory entries: ${demotedMemory.length}

Full proactive delivery lands in Phase 5.
`
    await writeFile(digestPath, body, 'utf-8')
    logger.info('wrote curation digest stub', { digestPath })
  }

  return { archivedSkills, flaggedSkills, demotedMemory, digestPath }
}

export function checkMemoryAddBudget(addition: string): void {
  const active = listEntries({
    layer: 'memory',
    status: 'active',
    limit: 200,
  })
  const current = active.reduce((n, e) => n + e.content.length + 1, 0)
  assertMemoryAddFits(current, addition.length, MEMORY_MAX_CHARS)
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`
  return candidate === root || candidate.startsWith(normalizedRoot)
}

/** Agent path installs are jailed; REST/UI may pass allowAnyLocalPath. */
export async function assertSkillInstallPathAllowed(
  filePath: string,
  options: { memoriesRoot?: string; allowAnyLocalPath?: boolean } = {},
): Promise<void> {
  if (options.allowAnyLocalPath) return

  const resolved = resolve(filePath)
  let real = resolved
  try {
    real = await realpath(resolved)
  } catch {
    // File may be missing; still jail on the resolved path.
  }

  const candidateRoots = [memoriesRoot(options.memoriesRoot), homedir()]
  const allowedRoots: string[] = []
  for (const root of candidateRoots) {
    const resolvedRoot = resolve(root)
    try {
      allowedRoots.push(await realpath(resolvedRoot))
    } catch {
      allowedRoots.push(resolvedRoot)
    }
  }
  if (!allowedRoots.some((root) => isPathInside(root, real))) {
    throw new SkillFetchError(
      'Skill path must be under your home directory or memories folder',
    )
  }
}

export async function installSkillFromPath(
  filePath: string,
  options: {
    id?: string
    bucketId?: string
    memoriesRoot?: string
    allowAnyLocalPath?: boolean
  } = {},
): Promise<string> {
  await assertSkillInstallPathAllowed(filePath, options)
  const body = await readFile(filePath, 'utf-8')
  const parsed = parseSkillFrontmatter(body, 'imported-skill')
  const id =
    options.id ?? parsed.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  await installSkillFromBody({
    id,
    body,
    provenance: 'imported',
    bucketId: options.bucketId ?? DEFAULT_BUCKET_ID,
    memoriesRoot: options.memoriesRoot,
  })
  return id
}

export const SKILL_FETCH_MAX_BYTES = 256 * 1024

export class SkillFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillFetchError'
  }
}

async function fetchSkillWithRedirectGuard(
  startUrl: URL,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<Response> {
  let current = startUrl
  for (let hop = 0; hop <= SKILL_FETCH_MAX_REDIRECTS; hop++) {
    try {
      assertSkillFetchUrlAllowed(current)
    } catch (err) {
      throw new SkillFetchError(
        err instanceof Error ? err.message : String(err),
      )
    }

    const res = await fetchFn(current.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      headers: { Accept: 'text/plain, text/markdown, */*' },
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) {
        throw new SkillFetchError(
          `Skill fetch redirect missing Location (${res.status})`,
        )
      }
      if (hop === SKILL_FETCH_MAX_REDIRECTS) {
        throw new SkillFetchError('Skill fetch exceeded redirect limit')
      }
      current = new URL(location, current)
      continue
    }

    return res
  }

  throw new SkillFetchError('Skill fetch exceeded redirect limit')
}

/** Download a SKILL.md from https (or http localhost) with size/timeout caps. */
export async function installSkillFromUrl(
  url: string,
  options: {
    id?: string
    bucketId?: string
    memoriesRoot?: string
    fetchImpl?: typeof fetch
    timeoutMs?: number
    maxBytes?: number
  } = {},
): Promise<string> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new SkillFetchError(`Invalid skill URL: ${url}`)
  }

  const { TIMEOUTS } = await import('@browseros/shared/constants/timeouts')
  const timeoutMs = options.timeoutMs ?? TIMEOUTS.SKILL_FETCH
  const maxBytes = options.maxBytes ?? SKILL_FETCH_MAX_BYTES
  const fetchFn = options.fetchImpl ?? fetch

  const res = await fetchSkillWithRedirectGuard(parsedUrl, fetchFn, timeoutMs)
  if (!res.ok) {
    throw new SkillFetchError(
      `Failed to fetch skill (${res.status} ${res.statusText})`,
    )
  }

  const contentType = res.headers.get('content-type') ?? ''
  if (contentType && !/text\/|markdown|octet-stream|json/i.test(contentType)) {
    throw new SkillFetchError(
      `Unexpected Content-Type for skill: ${contentType}`,
    )
  }

  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > maxBytes) {
    throw new SkillFetchError(
      `Skill body exceeds ${maxBytes} bytes (${buf.byteLength})`,
    )
  }
  const body = new TextDecoder('utf-8').decode(buf)
  const parsed = parseSkillFrontmatter(body, 'imported-skill')
  const id =
    options.id ?? parsed.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  await installSkillFromBody({
    id,
    body,
    provenance: 'imported',
    bucketId: options.bucketId ?? DEFAULT_BUCKET_ID,
    memoriesRoot: options.memoriesRoot,
  })
  return id
}

/**
 * Install a skill from a local path, a remote URL, or (unlike the other two,
 * which import someone else's file) by authoring a full SKILL.md body
 * directly — the path an agent with no connected workspace still uses to
 * turn a workflow it just ran into something reusable next time.
 */
export async function installSkillFromSource(
  source: { path?: string; url?: string; body?: string },
  options: {
    id?: string
    bucketId?: string
    memoriesRoot?: string
    allowAnyLocalPath?: boolean
  } = {},
): Promise<string> {
  const provided = [source.path, source.url, source.body].filter(
    (v) => v != null && v !== '',
  ).length
  if (provided !== 1) {
    throw new SkillFetchError('Provide exactly one of path, url, or body')
  }
  if (source.url) {
    return installSkillFromUrl(source.url, options)
  }
  if (source.path) {
    return installSkillFromPath(source.path, options)
  }
  return installSkillFromAuthoredBody(source.body as string, options)
}
