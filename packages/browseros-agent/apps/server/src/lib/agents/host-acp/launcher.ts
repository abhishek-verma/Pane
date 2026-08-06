/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Constructs the spawn command for a built-in ACP adapter. Prefers the BrowserOS-shipped Bun at
 * <resourcesDir>/bin/third_party/bun so end-user installs without Node
 * still have a working launcher; falls back to the existing
 * `npx -y …` command when the bundled binary is unavailable
 * (development configurations, third_party not shipped, platforms
 * outside darwin / linux / win32).
 */

import { type ResolvedHostBinary, resolveHostBinary } from './binary-resolver'
import { resolveBundledBun, withBundledBunAcpAdapterEnv } from './bundled-bun'
import {
  HOST_ACP_ADAPTER_CONFIG,
  type HostAcpAdapter,
  hasAcpPackageConfig,
} from './config'

export type AcpLauncherSource = 'bundled-bun' | 'host-npx-fallback'

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

  const resolve = input.resolveBundledBun ?? resolveBundledBun
  const bunPath = resolve({
    resourcesDir: input.resourcesDir,
    platform: input.platform,
  })
  if (bunPath) {
    return {
      command: wrapCommandWithEnv(
        `${quoteAcpCommandToken(bunPath)} x --bun --silent --package ${quoteAcpCommandToken(config.acpPackageSpec)} ${quoteAcpCommandToken(config.acpBin)}`,
        withBundledBunAcpAdapterEnv({
          bunPath,
          browserosDir: input.browserosDir,
          env: input.env,
          platform: input.platform,
        }),
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
  const command = npxResolved?.env
    ? wrapCommandWithEnv(baseCommand, npxResolved.env as Record<string, string>)
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
