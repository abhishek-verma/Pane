/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * File IO for ~/.browseros/memories/. Files are the source of truth.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_MEMORY_TEMPLATE,
  DEFAULT_SOUL_TEMPLATE,
  DEFAULT_USER_TEMPLATE,
  DIGESTS_DIR,
  MEMORY_FILE,
  SKILL_FILE,
  SKILLS_DIR,
  SOUL_FILE,
  STAGING_DIR,
  USER_FILE,
} from '@browseros/memory/constants'
import { assertMemoryContent } from '@browseros/memory/scan'
import type { PromptFiles } from '@browseros/memory/types'
import { getMemoriesDir } from '../lib/browseros-dir'

export function memoriesRoot(root?: string): string {
  return root ?? getMemoriesDir()
}

export async function ensureMemoriesLayout(root?: string): Promise<string> {
  const base = memoriesRoot(root)
  await mkdir(base, { recursive: true })
  await mkdir(join(base, SKILLS_DIR), { recursive: true })
  await mkdir(join(base, STAGING_DIR), { recursive: true })
  await mkdir(join(base, DIGESTS_DIR), { recursive: true })
  return base
}

async function readOrEmpty(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw err
  }
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  try {
    await writeFile(path, content, { encoding: 'utf-8', flag: 'wx' })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return
    throw err
  }
}

/** Seed templated prompt files if missing. Does not invent content from SQLite. */
export async function seedPromptFilesIfMissing(root?: string): Promise<void> {
  const base = await ensureMemoriesLayout(root)
  await writeIfMissing(join(base, SOUL_FILE), DEFAULT_SOUL_TEMPLATE)
  await writeIfMissing(join(base, USER_FILE), DEFAULT_USER_TEMPLATE)
  await writeIfMissing(join(base, MEMORY_FILE), DEFAULT_MEMORY_TEMPLATE)
}

export async function readPromptFiles(root?: string): Promise<PromptFiles> {
  const base = await ensureMemoriesLayout(root)
  const [soul, user, memory] = await Promise.all([
    readOrEmpty(join(base, SOUL_FILE)),
    readOrEmpty(join(base, USER_FILE)),
    readOrEmpty(join(base, MEMORY_FILE)),
  ])
  return { soul, user, memory }
}

export async function writePromptFile(
  which: 'soul' | 'user' | 'memory',
  content: string,
  root?: string,
): Promise<void> {
  assertMemoryContent(content)
  const base = await ensureMemoriesLayout(root)
  const name =
    which === 'soul' ? SOUL_FILE : which === 'user' ? USER_FILE : MEMORY_FILE
  await writeFile(join(base, name), content, 'utf-8')
}

/**
 * Write a prompt file and rebuild the SQLite index from files.
 * Use for Settings / persona wholesale edits so files stay source of truth
 * for recall and always-on prompt assembly.
 */
export async function writePromptFileAndReindex(
  which: 'soul' | 'user' | 'memory',
  content: string,
  root?: string,
): Promise<void> {
  await writePromptFile(which, content, root)
  const { rebuildIndexFromFiles } = await import('./store')
  await rebuildIndexFromFiles(root)
}

/** Append a bullet line to MEMORY.md (file SoT). */
export async function appendMemoryFileLine(
  line: string,
  root?: string,
): Promise<void> {
  const base = await ensureMemoriesLayout(root)
  const path = join(base, MEMORY_FILE)
  let existing = await readOrEmpty(path)
  if (!existing.trim()) existing = DEFAULT_MEMORY_TEMPLATE
  const trimmed = line.trim()
  const bullet = trimmed.startsWith('-') ? trimmed : `- ${trimmed}`
  const next = existing.endsWith('\n')
    ? `${existing}${bullet}\n`
    : `${existing}\n${bullet}\n`
  await writeFile(path, next, 'utf-8')
}

export async function removeMemoryFileLine(
  substring: string,
  root?: string,
): Promise<boolean> {
  const base = await ensureMemoriesLayout(root)
  const path = join(base, MEMORY_FILE)
  const existing = await readOrEmpty(path)
  if (!existing) return false
  const needle = substring.trim().toLowerCase()
  const lines = existing.split('\n')
  const kept = lines.filter((line) => !line.toLowerCase().includes(needle))
  if (kept.length === lines.length) return false
  await writeFile(path, kept.join('\n'), 'utf-8')
  return true
}

export function skillDir(skillId: string, root?: string): string {
  return join(memoriesRoot(root), SKILLS_DIR, skillId)
}

export function skillFilePath(skillId: string, root?: string): string {
  return join(skillDir(skillId, root), SKILL_FILE)
}

export async function writeSkillFile(
  skillId: string,
  body: string,
  root?: string,
): Promise<string> {
  const dir = skillDir(skillId, root)
  await mkdir(dir, { recursive: true })
  const path = skillFilePath(skillId, root)
  await writeFile(path, body, 'utf-8')
  return path
}

export async function readSkillFile(
  skillId: string,
  root?: string,
): Promise<string | null> {
  return (await readOrEmpty(skillFilePath(skillId, root))) || null
}

export async function listSkillIdsOnDisk(root?: string): Promise<string[]> {
  const base = await ensureMemoriesLayout(root)
  const skillsRoot = join(base, SKILLS_DIR)
  try {
    const entries = await readdir(skillsRoot, { withFileTypes: true })
    const ids: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const body = await readOrEmpty(join(skillsRoot, entry.name, SKILL_FILE))
      if (body.trim()) ids.push(entry.name)
    }
    return ids.sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

export async function writeStagedSkill(
  skillId: string,
  body: string,
  root?: string,
): Promise<string> {
  assertMemoryContent(body)
  const base = await ensureMemoriesLayout(root)
  const path = join(base, STAGING_DIR, `${skillId}.md`)
  await writeFile(path, body, 'utf-8')
  return path
}

export async function readStagedSkill(
  skillId: string,
  root?: string,
): Promise<string | null> {
  const base = memoriesRoot(root)
  return (await readOrEmpty(join(base, STAGING_DIR, `${skillId}.md`))) || null
}

export async function listStagedSkillIds(root?: string): Promise<string[]> {
  const base = await ensureMemoriesLayout(root)
  const staging = join(base, STAGING_DIR)
  try {
    const entries = await readdir(staging)
    return entries
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.replace(/\.md$/, ''))
      .sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}
