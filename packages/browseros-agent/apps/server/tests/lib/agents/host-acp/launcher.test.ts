/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { dirname } from 'node:path'
import { HOST_ACP_ADAPTER_CONFIG } from '../../../../src/lib/agents/host-acp/config'
import { resolveAcpSpawnCommand } from '../../../../src/lib/agents/host-acp/launcher'

const FAKE_BUN_PATH = '/Volumes/BrowserOS/bin/third_party/bun'
const WINDOWS_BUN_PATH =
  'C:\\Users\\shadowfax\\AppData\\Local\\BrowserOS\\Application\\148.0.7947.97\\BrowserOSServer\\default\\resources\\bin\\third_party\\bun.exe'

const stubBunPresent: typeof import('../../../../src/lib/agents/host-acp/bundled-bun').resolveBundledBun =
  () => FAKE_BUN_PATH

const stubBunMissing: typeof import('../../../../src/lib/agents/host-acp/bundled-bun').resolveBundledBun =
  () => null

const FAKE_NPX_PATH = '/usr/local/bin/npx'

const stubNpxPresent: (
  name: string,
) => Promise<{ path: string; env: NodeJS.ProcessEnv } | null> = async (
  _name,
) => ({
  path: FAKE_NPX_PATH,
  env: { PATH: `${dirname(FAKE_NPX_PATH)}:/usr/bin` },
})

const stubNpxMissing: (
  name: string,
) => Promise<{ path: string; env: NodeJS.ProcessEnv } | null> = async (_name) =>
  null

const stubNativeMissing: (
  name: string,
) => Promise<{ path: string; env: NodeJS.ProcessEnv } | null> = async () => null

function splitCommandLikeAcpx(value: string): {
  command: string
  args: string[]
} {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  let escaping = false

  for (const ch of value) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }
    if (ch === '\\' && quote !== "'") {
      escaping = true
      continue
    }
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }

  if (escaping) current += '\\'
  if (current.length > 0) parts.push(current)
  return { command: parts[0] ?? '', args: parts.slice(1) }
}

describe('resolveAcpSpawnCommand', () => {
  it('returns the bundled-bun launcher for claude when the binary exists', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'claude',
      env: { PATH: '/usr/bin' },
      resourcesDir: '/fake/resources',
      resolveBundledBun: stubBunPresent,
      resolveNative: stubNativeMissing,
    })
    expect(out).not.toBeNull()
    expect(out?.source).toBe('bundled-bun')
    expect(out?.command).toBe(
      `env PATH='${dirname(FAKE_BUN_PATH)}:/usr/bin' '${FAKE_BUN_PATH}' x --bun --silent --package '${HOST_ACP_ADAPTER_CONFIG.claude.acpPackageSpec}' '${HOST_ACP_ADAPTER_CONFIG.claude.acpBin}'`,
    )
  })

  it('returns the bundled-bun launcher for codex when the binary exists', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'codex',
      env: { PATH: '/usr/bin' },
      resourcesDir: '/fake/resources',
      resolveBundledBun: stubBunPresent,
      resolveNative: stubNativeMissing,
    })
    expect(out?.source).toBe('bundled-bun')
    expect(out?.command).toBe(
      `env PATH='${dirname(FAKE_BUN_PATH)}:/usr/bin' '${FAKE_BUN_PATH}' x --bun --silent --package '${HOST_ACP_ADAPTER_CONFIG.codex.acpPackageSpec}' '${HOST_ACP_ADAPTER_CONFIG.codex.acpBin}'`,
    )
  })

  it('keeps Codex on the adapter-compatible runtime even with an older host CLI', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'codex',
      env: { PATH: '/usr/bin' },
      resolveBundledBun: stubBunPresent,
      resolveNative: async () => ({
        path: '/Users/dev/.local/bin/codex',
        env: { PATH: '/Users/dev/.local/bin:/usr/bin' },
      }),
    })
    expect(out?.command).toContain('@agentclientprotocol/codex-acp@^1.10.0')
    expect(out?.command).not.toContain('CODEX_PATH=')
    expect(out?.command).not.toContain('@zed-industries')
  })

  it("prefers the resolved host CLI over Pane's packaged fallback", async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'claude',
      env: { PATH: '/usr/bin' },
      resourcesDir: '/fake/resources',
      resolveBundledBun: stubBunPresent,
      resolveNative: async () => ({
        path: '/Users/dev/.local/bin/claude',
        env: { PATH: '/Users/dev/.local/bin:/usr/bin' },
      }),
    })

    expect(out?.command).toBe(
      `env CLAUDE_CODE_EXECUTABLE='/Users/dev/.local/bin/claude' PATH='/Users/dev/.local/bin:/usr/bin' '${FAKE_BUN_PATH}' x --bun --silent --package '${HOST_ACP_ADAPTER_CONFIG.claude.acpPackageSpec}' '${HOST_ACP_ADAPTER_CONFIG.claude.acpBin}'`,
    )
  })

  it('uses the exact Claude executable with the npx fallback too', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'claude',
      resolveBundledBun: stubBunMissing,
      resolveNpx: stubNpxPresent,
      resolveNative: async () => ({
        path: '/Users/dev/CLI tools/claude',
        env: { PATH: '/usr/bin' },
      }),
    })
    expect(splitCommandLikeAcpx(out!.command).args).toContain(
      'CLAUDE_CODE_EXECUTABLE=/Users/dev/CLI tools/claude',
    )
  })

  it('falls back to the host npx command when the bundled binary is missing', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'claude',
      resourcesDir: '/fake/resources',
      resolveBundledBun: stubBunMissing,
      resolveNpx: stubNpxPresent,
      resolveNative: stubNativeMissing,
    })
    expect(out?.source).toBe('host-npx-fallback')
    const split = splitCommandLikeAcpx(out?.command ?? '')
    expect(split.command).toBe('env')
    expect(split.args).toContain(FAKE_NPX_PATH)
  })

  it('falls back to bare npx command when npx cannot be resolved', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'claude',
      resourcesDir: '/fake/resources',
      resolveBundledBun: stubBunMissing,
      resolveNpx: stubNpxMissing,
      resolveNative: stubNativeMissing,
    })
    expect(out?.source).toBe('host-npx-fallback')
    // bare 'npx' gets shell-quoted; acpx's splitCommandLine strips quotes so the spawned token is still `npx`
    const split = splitCommandLikeAcpx(out?.command ?? '')
    expect(split.command).toBe('npx')
  })

  it('returns null for acp-custom so the caller uses the user-supplied command', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'acp-custom',
      resourcesDir: '/fake/resources',
      resolveBundledBun: stubBunPresent,
    })
    expect(out).toBeNull()
  })

  it('returns null for an unknown agent type', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'gemini',
      resourcesDir: '/fake/resources',
      resolveBundledBun: stubBunPresent,
    })
    expect(out).toBeNull()
  })

  it('quotes the bundled bun path so paths with spaces survive', async () => {
    const bunWithSpaces =
      '/Applications/BrowserOS App/Contents/bin/third party/bun'
    const out = await resolveAcpSpawnCommand({
      agentType: 'claude',
      resourcesDir: '/Applications/BrowserOS.app/Contents/Resources',
      resolveBundledBun: () => bunWithSpaces,
      resolveNative: stubNativeMissing,
    })
    const split = splitCommandLikeAcpx(out?.command ?? '')
    const bunIndex = split.args.indexOf(bunWithSpaces)
    expect(split.command).toBe('env')
    expect(bunIndex).toBeGreaterThanOrEqual(0)
    expect(split.args.slice(bunIndex)).toEqual([
      bunWithSpaces,
      'x',
      '--bun',
      '--silent',
      '--package',
      HOST_ACP_ADAPTER_CONFIG.claude.acpPackageSpec,
      HOST_ACP_ADAPTER_CONFIG.claude.acpBin,
    ])
  })

  it('preserves Windows bundled bun path separators through acpx command splitting', async () => {
    const out = await resolveAcpSpawnCommand({
      agentType: 'claude',
      resourcesDir: 'C:\\fake\\resources',
      platform: 'win32',
      resolveBundledBun: () => WINDOWS_BUN_PATH,
      resolveNative: stubNativeMissing,
    })

    expect(out?.source).toBe('bundled-bun')
    const split = splitCommandLikeAcpx(out?.command ?? '')
    expect(split.args).toContain(WINDOWS_BUN_PATH)
  })
})
