import { afterEach, expect, it } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { detectHostAdapter } from '../../../../src/lib/agents/host-acp/detection'
import { resolveAcpSpawnCommand } from '../../../../src/lib/agents/host-acp/launcher'
import { resolvePackagedAcpRuntime } from '../../../../src/lib/agents/host-acp/packaged-runtime'

const roots: string[] = []
const originalNodeEnv = process.env.NODE_ENV
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const resources = mkdtempSync(join(tmpdir(), 'pane runtime test '))
  roots.push(resources)
  const root = join(resources, 'acp-runtime')
  mkdirSync(join(root, 'native/claude'), { recursive: true })
  const manifest = {
    schema: 1,
    platform: 'darwin',
    arch: process.arch,
    adapters: {
      claude: { entrypoint: 'claude.js', executable: 'claude' },
      codex: { entrypoint: 'codex.js', executable: 'codex' },
    },
  }
  for (const name of [
    'claude.js',
    'codex.js',
    'claude',
    'codex',
    'native-loader.cjs',
  ])
    writeFileSync(join(root, name), '')
  writeFileSync(join(root, 'runtime.json'), JSON.stringify(manifest))
  return { resources, root, manifest }
}

it('falls back to the release-owned runtime when no host CLI is installed', async () => {
  process.env.NODE_ENV = 'production'
  const { resources } = fixture()
  for (const agentType of ['claude', 'codex'] as const) {
    const result = await resolveAcpSpawnCommand({
      agentType,
      resourcesDir: resources,
      platform: 'darwin',
      resolveBundledBun: () => '/signed/bun',
      resolveNative: async () => null,
    })
    expect(result?.source).toBe('packaged-runtime')
    expect(result?.command).not.toContain('--package')
    expect(result?.command).not.toContain('npx')
    expect(result?.command).toContain('--preload=file:')
    expect(result?.command).toContain('%20')
    expect(result?.command).toContain(
      agentType === 'claude' ? 'CLAUDE_CODE_EXECUTABLE=' : 'CODEX_PATH=',
    )
  }
})

it.each([
  {
    hostVersion: 'codex-cli 0.146.0',
    bundledVersion: 'codex-cli 0.153.4',
    bundled: true,
  },
  {
    hostVersion: 'codex-cli 0.153.3',
    bundledVersion: 'codex-cli 0.153.4',
    bundled: true,
  },
  {
    hostVersion: 'codex-cli 0.153.4',
    bundledVersion: 'codex-cli 0.153.4',
    bundled: false,
  },
  {
    hostVersion: 'codex-cli 0.154.0',
    bundledVersion: 'codex-cli 0.153.4',
    bundled: false,
  },
  {
    hostVersion: 'codex-cli 1.0.0',
    bundledVersion: 'codex-cli 0.153.4',
    bundled: false,
  },
  {
    hostVersion: 'custom Codex build',
    bundledVersion: 'codex-cli 0.153.4',
    bundled: false,
  },
  {
    hostVersion: 'codex-cli 0.146.0',
    bundledVersion: 'unknown',
    bundled: false,
  },
])('selects consistent Codex launch/auth runtime for $hostVersion vs $bundledVersion', async ({
  hostVersion,
  bundledVersion,
  bundled,
}) => {
  const { resources, root } = fixture()
  const host = { path: '/host/codex', env: { PATH: '/host/bin' } }
  const bundledPath = realpathSync(join(root, 'codex'))
  const selectedPath = bundled ? bundledPath : host.path
  const authProbes: string[] = []
  const runCommand: import('../../../../src/lib/agents/host-acp/binary-resolver').HostCommandRunner =
    async (cmd, args) => {
      if (args[0] !== '--version') authProbes.push(cmd)
      return {
        exitCode: 0,
        stdout: cmd === host.path ? hostVersion : bundledVersion,
        stderr: '',
      }
    }
  const launch = await resolveAcpSpawnCommand({
    agentType: 'codex',
    resourcesDir: resources,
    platform: 'darwin',
    resolveBundledBun: () => '/signed/bun',
    resolveNative: async () => host,
    runCommand,
  })
  expect(launch?.command).toContain(`CODEX_PATH='${selectedPath}'`)
  const health = await detectHostAdapter('codex', {
    resourcesDir: resources,
    platform: 'darwin',
    resolveBundledBun: () => '/signed/bun',
    resolveBinary: async () => host,
    runCommand,
  })
  expect(health.version).toBe(bundled ? bundledVersion : hostVersion)
  expect(authProbes).toEqual([selectedPath])
})

it('retains installed Codex when a version comparison fails', async () => {
  const { resources } = fixture()
  const result = await resolveAcpSpawnCommand({
    agentType: 'codex',
    resourcesDir: resources,
    platform: 'darwin',
    resolveBundledBun: () => '/signed/bun',
    resolveNative: async () => ({ path: '/host/codex', env: {} }),
    runCommand: async () => {
      throw new Error('version probe timed out')
    },
  })
  expect(result?.command).toContain("CODEX_PATH='/host/codex'")
})

it('rejects mismatched platforms and manifest paths outside the bundle', () => {
  const { root, resources, manifest } = fixture()
  expect(() =>
    resolvePackagedAcpRuntime({
      resourcesDir: resources,
      agentType: 'claude',
      platform: 'linux',
    }),
  ).toThrow('does not match')
  manifest.adapters.claude.entrypoint = '../outside.js'
  writeFileSync(join(resources, 'outside.js'), '')
  writeFileSync(join(root, 'runtime.json'), JSON.stringify(manifest))
  expect(() =>
    resolvePackagedAcpRuntime({
      resourcesDir: resources,
      agentType: 'claude',
      platform: 'darwin',
    }),
  ).toThrow('Invalid path')
})

it('redirects every inventoried Bun native module before extraction and fails closed for unknown modules or symlinks', () => {
  const { root, resources } = fixture()
  const names = ['future-addon.node', '.bun-501-b16af-test.node']
  const native = join(root, 'native/claude')
  for (const name of names) writeFileSync(join(native, name), 'fixture')
  writeFileSync(
    join(native, 'manifest.json'),
    JSON.stringify({ schema: 1, modules: names }),
  )
  const loaded: string[] = []
  const processStub = {
    dlopen: (_module: unknown, filename: string) => loaded.push(filename),
  }
  const source = readFileSync(
    new URL(
      '../../../../../../scripts/build/acp-runtime/native-loader.cjs',
      import.meta.url,
    ),
    'utf8',
  )
  runInNewContext(source, {
    require: createRequire(import.meta.url),
    process: processStub,
    __dirname: root,
  })
  for (const name of names) processStub.dlopen({}, `/$bunfs/root/${name}`)
  expect(loaded).toEqual(names.map((name) => realpathSync(join(native, name))))
  expect(() => processStub.dlopen({}, '/$bunfs/root/new-unknown.node')).toThrow(
    'no unsigned module was loaded',
  )
  const external = join(resources, 'external.node')
  writeFileSync(external, 'fixture')
  rmSync(join(native, names[0]))
  symlinkSync(external, join(native, names[0]))
  expect(() => processStub.dlopen({}, `/$bunfs/root/${names[0]}`)).toThrow(
    'escapes',
  )
  expect(loaded).toHaveLength(2)
})

for (const agentType of ['claude', 'codex'] as const) {
  it(`launches installed ${agentType} in production without bundled native resources`, async () => {
    process.env.NODE_ENV = 'production'
    const { resources, root } = fixture()
    const executableKey =
      agentType === 'claude' ? 'CLAUDE_CODE_EXECUTABLE' : 'CODEX_PATH'
    const hostPath = join(resources, `host tools/${agentType}`)
    mkdirSync(join(resources, 'host tools'))
    writeFileSync(hostPath, `#!/bin/sh\nprintf 'host-${agentType}'\n`)
    chmodSync(hostPath, 0o755)
    writeFileSync(
      join(root, `${agentType}.js`),
      `
      if (process.env.BUN_OPTIONS || process.env.DISABLE_AUTOUPDATER)
        throw new Error('Bundled runtime environment leaked into the host CLI');
      const child = Bun.spawn([process.env.${executableKey}], { stdout: 'inherit' });
      process.exit(await child.exited);
    `,
    )
    for (const file of ['claude', 'codex', 'native-loader.cjs'])
      rmSync(join(root, file))
    const host = {
      path: hostPath,
      env: { PATH: '/usr/bin:/bin', TMPDIR: '/host/tmp' },
    }
    const result = await resolveAcpSpawnCommand({
      agentType,
      resourcesDir: resources,
      platform: 'darwin',
      browserosDir: join(resources, 'profile'),
      resolveBundledBun: () => process.execPath,
      resolveNative: async () => host,
    })
    expect(result?.source).toBe('packaged-runtime')
    expect(result?.command).toContain(`${executableKey}='${hostPath}'`)
    expect(result?.command).not.toContain('BUN_OPTIONS=')
    expect(result?.command).not.toContain('--package')
    expect(result?.command).toContain("TMPDIR='/host/tmp'")
    if (!result) throw new Error('Expected a launcher')
    // Execute the launch command: the adapter must actually reach the host CLI.
    const child = Bun.spawn(['sh', '-c', result.command], {
      env: { PATH: '/usr/bin:/bin' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(stdout).toBe(`host-${agentType}`)

    const probes: string[] = []
    const health = await detectHostAdapter(agentType, {
      resourcesDir: resources,
      platform: 'darwin',
      resolveBinary: async () => host,
      resolveBundledBun: () => process.execPath,
      runCommand: async (cmd, args, options) => {
        probes.push(cmd)
        expect(options.env).toEqual(host.env)
        return {
          exitCode: 0,
          stdout: args[0] === '--version' ? 'host-version' : '',
          stderr: '',
        }
      },
    })
    expect(health).toMatchObject({
      healthy: true,
      version: 'host-version',
      readiness: 'ready',
    })
    expect(probes).toEqual([hostPath, hostPath])
  })

  it(`probes bundled ${agentType} only when no host CLI is available`, async () => {
    process.env.NODE_ENV = 'production'
    const { resources, root } = fixture()
    const probes: string[] = []
    const health = await detectHostAdapter(agentType, {
      resourcesDir: resources,
      platform: 'darwin',
      resolveBinary: async () => null,
      resolveBundledBun: () => '/signed/bun',
      runCommand: async (cmd, args, options) => {
        probes.push(cmd)
        expect(options.env?.BUN_OPTIONS).toContain('--preload=file:')
        return {
          exitCode: 0,
          stdout: args[0] === '--version' ? 'bundled-version' : '',
          stderr: '',
        }
      },
    })
    expect(health).toMatchObject({ healthy: true, version: 'bundled-version' })
    expect(probes).toEqual([
      realpathSync(join(root, agentType)),
      realpathSync(join(root, agentType)),
    ])
  })
}

it('still requires packaged adapters in production even with an installed CLI', async () => {
  process.env.NODE_ENV = 'production'
  await expect(
    resolveAcpSpawnCommand({
      agentType: 'claude',
      resolveNative: async () => ({ path: '/host/claude', env: {} }),
    }),
  ).rejects.toThrow('runtime downloads are disabled')
})
