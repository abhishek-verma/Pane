/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * On macOS 16+, Bun-compiled ACP provider binaries (Claude Code, Codex)
 * extract embedded native .node modules to the system temp directory at
 * runtime. macOS Gatekeeper shows "Apple could not verify … is free of
 * malware" dialogs for each unsigned file every time the provider auto-updates.
 *
 * Two-layer fix:
 *
 * Layer 1 — ad-hoc signing (handles the current session and reboots):
 *   Redirect Bun's extraction to ~/.browseros/bun-tmp/ and ad-hoc sign any
 *   unsigned .node files there. Signed files persist across reboots. Both the
 *   health-check probe and the live ACP subprocess use this directory (via
 *   TMPDIR override in withBundledBunAcpAdapterEnv), so signed files are found
 *   on all subsequent loads.
 *
 * Layer 2 — spctl registration (permanent, survives all future auto-updates):
 *   Register the provider binary with Gatekeeper via `spctl --add`. The
 *   exception is tied to the Developer ID signing identity (e.g. Anthropic's
 *   Q6L2SF6YDW / com.anthropic.claude-code), NOT the binary path, so it
 *   persists through every future Claude Code auto-update without re-prompting.
 *   We first try without elevated privileges; if that fails, we prompt once via
 *   osascript's "with administrator privileges" — the same native macOS pattern
 *   used by Homebrew, Docker, etc. After a successful registration the flag is
 *   cached in ~/.browseros/ so we never prompt again.
 */

import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
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
 *
 * Also attempts a one-time `spctl --add` registration for the provider binary
 * so Gatekeeper never scans its dynamically-loaded code again — including
 * after future auto-updates (the exception is tied to the signing identity,
 * not the binary path).
 */
export async function prewarmProviderNativeModules(
  browserosDir: string,
  platform: NodeJS.Platform = process.platform,
  binaryPath?: string,
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

  // Layer 2: permanent spctl registration so future auto-updates never trigger
  // Gatekeeper dialogs. Fire-and-forget; failures are non-fatal.
  if (binaryPath) {
    void registerBinaryWithGatekeeper(binaryPath, browserosDir, platform)
  }
}

// ---------------------------------------------------------------------------
// spctl registration — permanent Gatekeeper exception
// ---------------------------------------------------------------------------

const GATEKEEPER_REGISTRY_FILE = 'gatekeeper-registered.json'

/**
 * Registers the given binary with macOS Gatekeeper via `spctl --add`.
 *
 * The exception is indexed by the binary's code-signing identity, so it
 * survives binary path changes (auto-updates). We record a flag in
 * `browserosDir` so the prompt never fires more than once per identity.
 *
 * Attempt order:
 *   1. `spctl --add <path>` without privileges (works on some configurations)
 *   2. `osascript` "with administrator privileges" (one-time native macOS prompt)
 *
 * Both attempts are silently swallowed on failure — the ad-hoc signing in
 * layer 1 still prevents dialogs for the current Claude Code version.
 */
export async function registerBinaryWithGatekeeper(
  binaryPath: string,
  browserosDir: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'darwin') return

  // Read the signing identity to use as the registry key.
  const identity = await readCodeSigningIdentity(binaryPath)
  if (!identity) return

  // Check if we already registered this identity.
  const registryPath = browserosDir
    ? join(browserosDir, GATEKEEPER_REGISTRY_FILE)
    : null
  if (registryPath && (await isIdentityRegistered(registryPath, identity))) {
    return
  }

  logger.info(
    `Registering ACP provider binary with Gatekeeper (identity: ${identity})`,
  )

  const registered = await trySpctlAdd(binaryPath)
  if (registered) {
    logger.info(`Registered ${binaryPath} with Gatekeeper (no prompt needed)`)
    if (registryPath) await markIdentityRegistered(registryPath, identity)
    return
  }

  // Fallback: ask once via osascript admin prompt.
  const adminRegistered = await trySpctlAddViaOsascript(binaryPath)
  if (adminRegistered) {
    logger.info(`Registered ${binaryPath} with Gatekeeper via admin prompt`)
    if (registryPath) await markIdentityRegistered(registryPath, identity)
  }
}

async function trySpctlAdd(binaryPath: string): Promise<boolean> {
  try {
    await execFileAsync('spctl', ['--add', binaryPath], { timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

async function trySpctlAddViaOsascript(binaryPath: string): Promise<boolean> {
  // Escape single quotes in the path for the shell string inside AppleScript.
  const escapedPath = binaryPath.replace(/'/g, "'\\''")
  const script = `do shell script "spctl --add '${escapedPath}'" with administrator privileges`
  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 60_000 })
    return true
  } catch {
    return false
  }
}

async function readCodeSigningIdentity(
  binaryPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'codesign',
      ['-dv', '--verbose=4', binaryPath],
      { timeout: 5_000 },
    )
    // Extract TeamIdentifier + Identifier as a stable key.
    const teamMatch = (stdout || '').match(/TeamIdentifier=(\S+)/)
    const identifierMatch = (stdout || '').match(/^Identifier=(\S+)/m)
    if (teamMatch?.[1] && identifierMatch?.[1]) {
      return `${teamMatch[1]}/${identifierMatch[1]}`
    }
    return null
  } catch {
    return null
  }
}

async function isIdentityRegistered(
  registryPath: string,
  identity: string,
): Promise<boolean> {
  try {
    const raw = await readFile(registryPath, 'utf8')
    const registry: Record<string, boolean> = JSON.parse(raw)
    return registry[identity] === true
  } catch {
    return false
  }
}

async function markIdentityRegistered(
  registryPath: string,
  identity: string,
): Promise<void> {
  let registry: Record<string, boolean> = {}
  try {
    const raw = await readFile(registryPath, 'utf8')
    registry = JSON.parse(raw)
  } catch {
    // file doesn't exist yet — start fresh
  }
  registry[identity] = true
  try {
    await writeFile(registryPath, JSON.stringify(registry, null, 2))
  } catch (err) {
    logger.warn(`Failed to write Gatekeeper registry: ${String(err)}`)
  }
}

/** Fallback dir used when `browserosDir` is unavailable (e.g. tests). */
export function defaultPrewarmDir(): string {
  return tmpdir()
}
