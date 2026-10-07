/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Production uses the release-owned adapter with the selected CLI, preferring
 * the packaged Codex when newer and using packaged CLIs when none is installed. Missing adapter
 * resources fail explicitly; package runners are development-only fallbacks.
 */

import { pathToFileURL } from 'node:url'
import {
  type HostCommandRunner,
  type ResolvedHostBinary,
  resolveHostBinary,
} from './binary-resolver'
import { resolveBundledBun, withBundledBunAcpAdapterEnv } from './bundled-bun'
import { selectHostCodexRuntime } from './codex-runtime-selection'
import {
  HOST_ACP_ADAPTER_CONFIG,
  type HostAcpAdapter,
  hasAcpPackageConfig,
} from './config'
import { resolvePackagedAcpRuntime } from './packaged-runtime'

export type AcpLauncherSource =
  | 'packaged-runtime'
  | 'bundled-bun'
  | 'host-npx-fallback'

export interface AcpLauncherResolution {
  command: string
  source: AcpLauncherSource
}

export interface ResolveAcpSpawnCommandInput {
  agentType: string
  browserosDir?: string | null
  env?: NodeJS.ProcessEnv
  resourcesDir?: string | null
  platform?: NodeJS.Platform
  /** Injected for tests; production callers leave it unset. */
  resolveBundledBun?: typeof resolveBundledBun
  /** Injected for tests; production callers leave it unset. */
  resolveNpx?: (name: string) => Promise<ResolvedHostBinary | null>
  /** Resolves the user's Claude/Codex CLI so it cannot be shadowed by Pane. */
  resolveNative?: (name: string) => Promise<ResolvedHostBinary | null>
  runCommand?: HostCommandRunner
}

/**
 * Build the spawn command for a built-in ACP agent.
 *
 * Returns null when:
 *   - the agent type is not a known built-in (e.g. acp-custom; caller
 *     uses the user-supplied command instead), OR
 *   - the registry entry has no package spec.
 */
export async function resolveAcpSpawnCommand(
  input: ResolveAcpSpawnCommandInput,
): Promise<AcpLauncherResolution | null> {
  if (!(input.agentType in HOST_ACP_ADAPTER_CONFIG)) return null
  const config = HOST_ACP_ADAPTER_CONFIG[input.agentType as HostAcpAdapter]
  if (!hasAcpPackageConfig(config)) return null

  const resolveNative =
    input.resolveNative ??
    ((name: string) =>
      resolveHostBinary(name, { env: input.env, platform: input.platform }))
  const native = await selectHostCodexRuntime({
    ...input,
    host: await resolveNative(config.nativeBinary).catch(() => null),
  })
  const executableEnvKey =
    input.agentType === 'claude' ? 'CLAUDE_CODE_EXECUTABLE' : 'CODEX_PATH'
  const nativeOverrides: Record<string, string> = native
    ? { [executableEnvKey]: native.path }
    : {}

  const packaged = resolvePackagedAcpRuntime({
    ...input,
    agentType: input.agentType as HostAcpAdapter,
    useHostExecutable: !!native,
  })
  if (packaged) {
    const bunPath = (input.resolveBundledBun ?? resolveBundledBun)(input)
    if (!bunPath)
      throw new Error(
        'Pane is missing its packaged JavaScript runtime. Reinstall Pane.',
      )
    return {
      source: 'packaged-runtime',
      command: wrapCommandWithEnv(
        `${quoteAcpCommandToken(bunPath)} ${quoteAcpCommandToken(packaged.entrypoint)}`,
        {
          ...withBundledBunAcpAdapterEnv({
            bunPath,
            browserosDir: input.browserosDir,
            env: native?.env ?? input.env,
            platform: input.platform,
            includeBundledCliPath: !native,
          }),
          ...nativeOverrides,
          ...(!native && packaged.executable
            ? {
                [executableEnvKey]: packaged.executable,
              }
            : {}),
          ...(packaged.preload
            ? {
                BUN_OPTIONS: `--preload=${pathToFileURL(packaged.preload).href}`,
              }
            : {}),
          ...(!native ? { DISABLE_AUTOUPDATER: '1', BUN_BE_BUN: '0' } : {}),
        },
      ),
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Pane is missing its packaged provider runtime. Update or reinstall Pane; runtime downloads are disabled in production.',
    )
  }

  const resolve = input.resolveBundledBun ?? resolveBundledBun
  const bunPath = resolve({
    resourcesDir: input.resourcesDir,
    platform: input.platform,
  })
  if (bunPath) {
    // Both adapters use the exact executable discovered in the user's shell.
    return {
      command: wrapCommandWithEnv(
        `${quoteAcpCommandToken(bunPath)} x --bun --silent --package ${quoteAcpCommandToken(config.acpPackageSpec)} ${quoteAcpCommandToken(config.acpBin)}`,
        {
          ...withBundledBunAcpAdapterEnv({
            bunPath,
            browserosDir: input.browserosDir,
            env: native?.env ?? input.env,
            platform: input.platform,
            includeBundledCliPath: !native,
          }),
          ...nativeOverrides,
        },
      ),
      source: 'bundled-bun',
    }
  }

  // Bundled bun unavailable — resolve npx via the user's login shell so
  // GUI-launched apps (which have a minimal PATH) can still find it.
  const resolveNpx =
    input.resolveNpx ??
    ((name: string) => resolveHostBinary(name, { env: input.env }))
  const npxResolved = await resolveNpx('npx').catch(() => null)
  const npxBin = npxResolved?.path ?? 'npx'
  const baseCommand = config.acpCommand.replace(
    /^npx\b/,
    quoteAcpCommandToken(npxBin),
  )
  // Wrap with the enriched env so that shebang interpreters (e.g. `#!/usr/bin/env node`)
  // referenced by the npx script can be found even in a GUI-launched minimal PATH.
  const command =
    npxResolved?.env || Object.keys(nativeOverrides).length
      ? wrapCommandWithEnv(baseCommand, {
          ...(npxResolved?.env as Record<string, string>),
          ...nativeOverrides,
        })
      : baseCommand
  return { command, source: 'host-npx-fallback' }
}

/** Quotes a token for acpx command splitting while preserving Windows backslashes. */
function quoteAcpCommandToken(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function wrapCommandWithEnv(
  command: string,
  env: Record<string, string>,
): string {
  const prefix = Object.entries(env)
    // Children already inherit these values. Do not copy the entire host
    // environment (including credentials) into the adapter's command line.
    .filter(([key, value]) => process.env[key] !== value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${quoteAcpCommandToken(value)}`)
    .join(' ')
  return prefix ? `env ${prefix} ${command}` : command
}
