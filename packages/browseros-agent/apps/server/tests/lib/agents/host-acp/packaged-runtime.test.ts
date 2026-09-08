import { afterEach, expect, it } from 'bun:test'
import {
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
import { resolveAcpSpawnCommand } from '../../../../src/lib/agents/host-acp/launcher'
import { resolvePackagedAcpRuntime } from '../../../../src/lib/agents/host-acp/packaged-runtime'

const roots: string[] = []
afterEach(() => {
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

it('launches only the release-owned runtime, without a host lookup or package runner', async () => {
  const { resources } = fixture()
  for (const agentType of ['claude', 'codex'] as const) {
    const result = await resolveAcpSpawnCommand({
      agentType,
      resourcesDir: resources,
      platform: 'darwin',
      resolveBundledBun: () => '/signed/bun',
      resolveNative: async () => {
        throw new Error('must not look up host CLI')
      },
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
