/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * On macOS 16+, Bun-compiled ACP provider binaries (Claude Code, Codex)
 * extract embedded native .node modules to the system temp directory at
 * runtime. macOS Gatekeeper then shows "Apple could not verify … is free
 * of malware" dialogs for each unsigned file — once per file per reboot.
 *
 * Fix: redirect Bun's extraction to a persistent directory under the
 * BrowserOS state folder, then ad-hoc sign any unsigned .node files found
 * there. Ad-hoc signing gives each file a verifiable (if self-issued)
 * signature, which is sufficient for macOS to skip the malware-scan dialog
 * for locally-extracted code that carries no quarantine attribute.
 *
 * The signed files survive reboots, so the one-time signing cost is paid
 * during the first provider health-check — never during an active chat turn.
 * When a provider binary updates, its embedded modules change content → new
 * hash → new filenames → re-signed on the next probe.
 */

import { execFile } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { logger } from '../../logger'

const execFileAsync = promisify(execFile)

/** Subdirectory under the BrowserOS state dir used as Bun's extraction root. */
export const BUN_PREWARM_SUBDIR = 'bun-tmp'

/**
 * Returns the persistent directory Bun should use for native-module
 * extraction instead of `os.tmpdir()`. Creates the directory if absent.
 */
export async function ensurePrewarmDir(browserosDir: string): Promise<string> {
  const dir = join(browserosDir, BUN_PREWARM_SUBDIR)
  await mkdir(dir, { recursive: true })
  return dir
}

/**
 * Returns env overrides that redirect Bun's temp-file extraction to
 * `prewarmDir` rather than the system `os.tmpdir()`.
 *
 * `TMPDIR` is the POSIX standard that Bun (and most Unix tools) consult
 * for temporary-file placement on macOS/Linux.
 */
export function prewarmEnvOverrides(
  prewarmDir: string,
): Record<string, string> {
  return { TMPDIR: prewarmDir }
}

export interface SignUnsignedNodeFilesResult {
  signed: string[]
  failed: string[]
  skipped: string[]
}

/**
 * Ad-hoc signs any unsigned `.node` (Mach-O dylib) files found directly
 * under `dir`. Ignores files that are already signed.
 *
 * Ad-hoc signing (`codesign --sign -`) is sufficient on macOS to prevent
 * the "could not verify is free of malware" Gatekeeper dialog for
 * locally-extracted, non-quarantined code.
 *
 * No-op on non-Darwin platforms.
 */
export async function signUnsignedNodeFiles(
  dir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<SignUnsignedNodeFilesResult> {
  const result: SignUnsignedNodeFilesResult = {
    signed: [],
    failed: [],
    skipped: [],
  }

  if (platform !== 'darwin') return result

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return result
  }

  const nodeFiles = entries.filter((e) => e.endsWith('.node'))
  if (nodeFiles.length === 0) return result

  await Promise.all(
    nodeFiles.map(async (filename) => {
      const filePath = join(dir, filename)
      try {
        const info = await stat(filePath)
        if (!info.isFile()) {
          result.skipped.push(filename)
          return
        }
      } catch {
        result.skipped.push(filename)
        return
      }

      if (await isAlreadySigned(filePath)) {
        result.skipped.push(filename)
        return
      }

      try {
        await execFileAsync('codesign', ['--sign', '-', '--force', filePath], {
          timeout: 10_000,
        })
        logger.info(`Ad-hoc signed extracted .node module: ${filePath}`)
        result.signed.push(filename)
      } catch (err) {
        logger.warn(
          `Failed to ad-hoc sign .node module ${filePath} — Gatekeeper dialogs may appear`,
          { err },
        )
        result.failed.push(filename)
      }
    }),
  )

  return result
}

async function isAlreadySigned(filePath: string): Promise<boolean> {
  try {
    const { exitCode } = await runCodesignDisplay(filePath)
    return exitCode === 0
  } catch {
    return false
  }
}

async function runCodesignDisplay(
  filePath: string,
): Promise<{ exitCode: number }> {
  return new Promise((resolve) => {
    const child = execFile(
      'codesign',
      ['-d', '--verbose=0', filePath],
      { timeout: 5_000 },
      (err) => {
        resolve({ exitCode: err?.code != null ? (err.code as number) : 0 })
      },
    )
    child.on('error', () => resolve({ exitCode: 1 }))
  })
}

/**
 * Convenience: ensure the prewarm dir exists and sign any unsigned .node
 * files already present. Called after a successful provider version probe
 * (which triggers Bun's extraction) so that subsequent runs are silent.
 */
export async function prewarmProviderNativeModules(
  browserosDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'darwin') return
  try {
    const dir = await ensurePrewarmDir(browserosDir)
    const { signed, failed } = await signUnsignedNodeFiles(dir, platform)
    if (signed.length > 0) {
      logger.info(
        `Pre-warmed ACP provider native modules: ${signed.length} signed, ${failed.length} failed in ${dir}`,
      )
    }
  } catch (err) {
    logger.warn(
      `ACP provider native-module pre-warm failed (non-fatal): ${String(err)}`,
    )
  }
}

/** Fallback dir used when `browserosDir` is unavailable (e.g. tests). */
export function defaultPrewarmDir(): string {
  return tmpdir()
}
