/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Production launches only the release-owned, locked adapter/runtime closure.
 * Missing/corrupt resources fail explicitly rather than downloading code during
 * a chat. Package runners and host CLI overrides are development-only fallbacks.
 */

import { pathToFileURL } from 'node:url'
import { type ResolvedHostBinary, resolveHostBinary } from './binary-resolver'
import { resolveBundledBun, withBundledBunAcpAdapterEnv } from './bundled-bun'
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

  const packaged = resolvePackagedAcpRuntime({
    ...input,
    agentType: input.agentType as HostAcpAdapter,
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
            env: input.env,
            platform: input.platform,
          }),
          // Use only the release-tested CLI, not an older SDK copy or host PATH.
          ...(packaged.executable
            ? {
                [input.agentType === 'claude'
                  ? 'CLAUDE_CODE_EXECUTABLE'
                  : 'CODEX_PATH']: packaged.executable,
              }
            : {}),
          ...(packaged.preload
            ? {
                BUN_OPTIONS: `--preload=${pathToFileURL(packaged.preload).href}`,
              }
            : {}),
          DISABLE_AUTOUPDATER: '1',
          BUN_BE_BUN: '0',
        },
      ),
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Pane is missing its packaged provider runtime. Update or reinstall Pane; runtime downloads are disabled in production.',
    )
  }

  const resolveNative =
    input.resolveNative ??
    ((name: string) =>
      resolveHostBinary(name, { env: input.env, platform: input.platform }))
  const native = await resolveNative(config.nativeBinary).catch(() => null)
  // Claude ACP resolves its SDK's private CLI, not `claude` on PATH.
  // Its documented override must name the exact executable we detected.
  const nativeOverrides: Record<string, string> =
    input.agentType === 'claude' && native
      ? { CLAUDE_CODE_EXECUTABLE: native.path }
      : {}

  const resolve = input.resolveBundledBun ?? resolveBundledBun
  const bunPath = resolve({
    resourcesDir: input.resourcesDir,
    platform: input.platform,
  })
  if (bunPath) {
    // Claude uses the explicit executable override above. Codex uses the
    // adapter's compatible runtime by default, not an arbitrary host CLI:
    // a host CLI can itself be too old for the user's selected model.
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
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${quoteAcpCommandToken(value)}`)
    .join(' ')
  return prefix ? `env ${prefix} ${command}` : command
}
