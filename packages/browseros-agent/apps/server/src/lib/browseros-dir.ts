/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { unlinkSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import type { ServerDiscoveryConfig } from '@browseros/shared/types/server-config'
import { logger } from './logger'
import { tryGetProfileKey } from './profile-context'

export const TOOL_OUTPUT_DIR_MODE = 0o700
export const TOOL_OUTPUT_FILE_MODE = 0o600

/** Install-wide BrowserOS root (ports, lock, identity, profiles/). */
export function getInstallBrowserosDir(): string {
  const override = process.env.BROWSEROS_DIR?.trim()
  if (override) {
    return override
  }
  const dirName =
    process.env.NODE_ENV === 'development'
      ? PATHS.DEV_BROWSEROS_DIR_NAME
      : PATHS.BROWSEROS_DIR_NAME
  return join(homedir(), dirName)
}

/**
 * Active data root for user state.
 * When a Chrome profile context is bound, returns
 * `<install>/profiles/<profileKey>`; otherwise the install root (tests /
 * legacy explicit-db boot).
 */
export function getBrowserosDir(): string {
  const profileKey = tryGetProfileKey()
  if (profileKey) {
    return join(getInstallBrowserosDir(), PATHS.PROFILES_DIR_NAME, profileKey)
  }
  return getInstallBrowserosDir()
}

/** Per-profile data directory for an explicit profile key. */
export function getProfileDataDir(profileKey: string): string {
  return join(getInstallBrowserosDir(), PATHS.PROFILES_DIR_NAME, profileKey)
}

export function logDevelopmentBrowserosDir(): void {
  if (process.env.NODE_ENV !== 'development') return
  logger.info(
    `Using development BrowserOS directory: ${getInstallBrowserosDir()}`,
  )
}

export function getSessionsDir(): string {
  return join(getBrowserosDir(), PATHS.SESSIONS_DIR_NAME)
}

export function getCacheDir(): string {
  return join(getInstallBrowserosDir(), PATHS.CACHE_DIR_NAME)
}

/** Pane memory/skills root under the active profile data dir. */
export function getMemoriesDir(): string {
  return join(getBrowserosDir(), PATHS.MEMORIES_DIR_NAME)
}

export function getCaptureDir(): string {
  return join(getBrowserosDir(), PATHS.CAPTURE_DIR_NAME)
}

/** Returns the ready-to-use directory for large generated tool outputs. */
export async function getToolOutputDir(): Promise<string> {
  const outputDirPath = join(getBrowserosDir(), 'tool-output')
  await mkdir(outputDirPath, {
    recursive: true,
    mode: TOOL_OUTPUT_DIR_MODE,
  })
  const info = await lstat(outputDirPath)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('BrowserOS tool output directory must be a real directory.')
  }
  const outputDir = await realpath(outputDirPath)
  await chmod(outputDir, TOOL_OUTPUT_DIR_MODE)
  return outputDir
}

/** Writes a generated tool output file with private owner-only permissions. */
export async function writeToolOutputFile(
  filePath: string,
  content: string,
): Promise<void> {
  await writeFile(filePath, content, {
    encoding: 'utf-8',
    flag: 'wx',
    mode: TOOL_OUTPUT_FILE_MODE,
  })
  await chmod(filePath, TOOL_OUTPUT_FILE_MODE)
}

/** Writes binary tool output (PDFs, downloads) with the same owner-only permissions. */
export async function writeToolOutputBinaryFile(
  filePath: string,
  content: Uint8Array,
): Promise<void> {
  await writeFile(filePath, content, {
    flag: 'wx',
    mode: TOOL_OUTPUT_FILE_MODE,
  })
  await chmod(filePath, TOOL_OUTPUT_FILE_MODE)
}

/** Returns the durable SQLite database path for the active profile (or install root). */
export function getDbPath(): string {
  return join(getBrowserosDir(), PATHS.DB_DIR_NAME, PATHS.DB_FILE_NAME)
}

/** Returns the DB path for an explicit profile key. */
export function getProfileDbPath(profileKey: string): string {
  return join(
    getProfileDataDir(profileKey),
    PATHS.DB_DIR_NAME,
    PATHS.DB_FILE_NAME,
  )
}

function getServerConfigPath(): string {
  return join(getInstallBrowserosDir(), PATHS.SERVER_CONFIG_FILE_NAME)
}

export async function writeServerConfig(
  config: ServerDiscoveryConfig,
): Promise<void> {
  await writeFile(getServerConfigPath(), `${JSON.stringify(config, null, 2)}\n`)
}

export function removeServerConfigSync(): void {
  try {
    unlinkSync(getServerConfigPath())
  } catch {
    return
  }
}

export async function ensureBrowserosDir(): Promise<void> {
  logDevelopmentBrowserosDir()
  await mkdir(getInstallBrowserosDir(), { recursive: true })
  await mkdir(join(getInstallBrowserosDir(), PATHS.PROFILES_DIR_NAME), {
    recursive: true,
  })
  // When a profile context is active, also ensure that profile's dirs.
  if (tryGetProfileKey()) {
    await mkdir(getSessionsDir(), { recursive: true })
    await mkdir(getCaptureDir(), { recursive: true })
    await getToolOutputDir()
  }
}

/** Ensures sessions/capture/tool-output exist under the active profile root. */
export async function ensureProfileDataDirs(): Promise<void> {
  await mkdir(getSessionsDir(), { recursive: true })
  await mkdir(getCaptureDir(), { recursive: true })
  await mkdir(getMemoriesDir(), { recursive: true })
  await getToolOutputDir()
}

export async function cleanOldSessions(): Promise<void> {
  const profileKeys = await listKnownProfileKeys()
  if (profileKeys.length === 0) {
    // Legacy layout: sessions may still live at install root.
    await cleanSessionsUnder(
      join(getInstallBrowserosDir(), PATHS.SESSIONS_DIR_NAME),
    )
    return
  }
  for (const key of profileKeys) {
    await cleanSessionsUnder(
      join(getProfileDataDir(key), PATHS.SESSIONS_DIR_NAME),
    )
  }
}

async function cleanSessionsUnder(sessionsDir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(sessionsDir)
  } catch {
    return
  }

  const cutoff = Date.now() - PATHS.SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000
  let removed = 0

  for (const entry of entries) {
    const entryPath = join(sessionsDir, entry)
    try {
      const info = await stat(entryPath)
      if (info.isDirectory() && info.mtimeMs < cutoff) {
        await rm(entryPath, { recursive: true })
        removed++
      }
    } catch {
      // skip entries that were already removed or inaccessible
    }
  }

  if (removed > 0) {
    logger.info(`Cleaned ${removed} stale session directories`, { sessionsDir })
  }
}

/** Lists profile keys that already have a directory under profiles/. */
export async function listKnownProfileKeys(): Promise<string[]> {
  const profilesRoot = join(getInstallBrowserosDir(), PATHS.PROFILES_DIR_NAME)
  let entries: string[]
  try {
    entries = await readdir(profilesRoot)
  } catch {
    return []
  }

  const keys: string[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const entryPath = join(profilesRoot, entry)
    try {
      const info = await stat(entryPath)
      if (info.isDirectory()) keys.push(entry)
    } catch {
      // skip
    }
  }
  return keys
}
