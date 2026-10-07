import {
  type HostCommandRunner,
  type ResolvedHostBinary,
  runHostCommand,
} from './binary-resolver'
import { resolvePackagedAcpRuntime } from './packaged-runtime'

/** Keep newer installed CLIs, but do not let an older Codex hide bundled models. */
export async function selectHostCodexRuntime(input: {
  agentType: string
  host: ResolvedHostBinary | null
  resourcesDir?: string | null
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  runCommand?: HostCommandRunner
}): Promise<ResolvedHostBinary | null> {
  if (input.agentType !== 'codex' || !input.host || !input.resourcesDir)
    return input.host
  try {
    const bundled = resolvePackagedAcpRuntime({
      resourcesDir: input.resourcesDir,
      platform: input.platform,
      agentType: 'codex',
    })
    if (!bundled?.executable) return input.host
    const run = input.runCommand ?? runHostCommand
    const [host, packaged] = await Promise.all([
      run(input.host.path, ['--version'], {
        env: input.host.env,
        timeoutMs: 3_000,
      }),
      run(bundled.executable, ['--version'], {
        env: input.env ?? process.env,
        timeoutMs: 3_000,
      }),
    ])
    if (host.exitCode !== 0 || packaged.exitCode !== 0) return input.host
    const current = parseVersion(host.stdout)
    const shipped = parseVersion(packaged.stdout)
    if (!current || !shipped) return input.host
    for (let index = 0; index < 3; index++) {
      if (shipped[index] > current[index]) return null
      if (shipped[index] < current[index]) return input.host
    }
  } catch {
    // Unknown/custom CLI versions and incomplete bundles retain host selection.
    // Launch/authentication failures are still surfaced by the normal probes.
  }
  return input.host
}

function parseVersion(value: string): number[] | null {
  const match = /^codex-cli (\d+)\.(\d+)\.(\d+)\s*$/.exec(value.trim())
  return match ? match.slice(1).map(Number) : null
}
