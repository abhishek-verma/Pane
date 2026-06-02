import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { S3Client } from '@aws-sdk/client-s3'
import { getTargetRules, loadManifest } from './manifest'
import { stageCompiledArtifact, stageTargetArtifact } from './stage'
import type { BuildTarget, R2Config, ResourceRule } from './types'

describe('server artifact staging', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('loads empty local-resource rules from the manifest', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'browseros-stage-test-'))
    const manifestPath = join(tempDir, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify({ resources: [] }))

    expect(loadManifest(manifestPath)).toEqual({
      resources: [],
    })
  })

  it('parses recursive local-resource rules from the manifest', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'browseros-stage-test-'))
    const manifestPath = join(tempDir, 'manifest.json')
    await writeFile(
      manifestPath,
      JSON.stringify({
        resources: [
          {
            name: 'Drizzle migrations',
            source: {
              type: 'local',
              path: 'apps/server/src/lib/db/migrations',
            },
            destination: 'resources/db/migrations',
            recursive: true,
            os: ['macos'],
            arch: ['arm64', 'x64'],
          },
        ],
      }),
    )

    expect(loadManifest(manifestPath).resources[0]).toMatchObject({
      name: 'Drizzle migrations',
      recursive: true,
    })
  })

  it('copies recursive local resource directories', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'browseros-stage-test-'))
    const sourceRoot = join(tempDir, 'source')
    const distRoot = join(tempDir, 'dist')
    const binaryPath = join(tempDir, 'browseros-server')
    const migrationsDir = join(sourceRoot, 'apps/server/src/lib/db/migrations')
    await mkdir(join(migrationsDir, 'meta'), { recursive: true })
    await writeFile(binaryPath, 'server')
    await writeFile(join(migrationsDir, '0000_init.sql'), 'CREATE TABLE x;')
    await writeFile(
      join(migrationsDir, 'meta', '_journal.json'),
      '{"entries":[]}',
    )

    const artifact = await stageCompiledArtifact(
      distRoot,
      binaryPath,
      testTarget,
      '0.0.0-test',
      [migrationRule],
      sourceRoot,
    )

    expect(
      await readFile(
        join(artifact.resourcesDir, 'db/migrations/0000_init.sql'),
        'utf8',
      ),
    ).toBe('CREATE TABLE x;')
    expect(
      await readFile(
        join(artifact.resourcesDir, 'db/migrations/meta/_journal.json'),
        'utf8',
      ),
    ).toBe('{"entries":[]}')
  })

  it('downloads R2 executable resources and marks them executable', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'browseros-stage-test-'))
    const sourceRoot = join(tempDir, 'source')
    const distRoot = join(tempDir, 'dist')
    const binaryPath = join(tempDir, 'browseros-server')
    const payload = new TextEncoder().encode('#!/bin/sh\n')
    await writeFile(binaryPath, 'server')

    const artifact = await stageTargetArtifact(
      distRoot,
      binaryPath,
      testTarget,
      [bunRule],
      sourceRoot,
      {
        send: async () => ({
          Body: {
            transformToByteArray: async () => payload,
          },
        }),
      } as unknown as S3Client,
      fakeR2Config,
      '0.0.0-test',
    )

    const bunPath = join(artifact.resourcesDir, 'bin/third_party/bun')
    expect(await readFile(bunPath, 'utf8')).toBe('#!/bin/sh\n')
    expect((await stat(bunPath)).mode & 0o111).not.toBe(0)
  })

  for (const { target, expectedKey, expectedRelativePath } of [
    {
      target: linuxArm64Target,
      expectedKey: 'third_party/bun/bun-linux-arm64',
      expectedRelativePath: 'bin/third_party/bun',
    },
    {
      target: linuxX64Target,
      expectedKey: 'third_party/bun/bun-linux-x64-baseline',
      expectedRelativePath: 'bin/third_party/bun',
    },
    {
      target: windowsX64Target,
      expectedKey: 'third_party/bun/bun-windows-x64-baseline.exe',
      expectedRelativePath: 'bin/third_party/bun.exe',
    },
  ]) {
    it(`stages the platform Bun resource for ${target.id}`, async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'browseros-stage-test-'))
      const sourceRoot = join(tempDir, 'source')
      const distRoot = join(tempDir, 'dist')
      const binaryPath = join(tempDir, target.serverBinaryName)
      const requests: string[] = []
      const payload = new TextEncoder().encode(`${target.id}-bun`)
      await writeFile(binaryPath, 'server')

      const rules = bunRulesForTarget(target)
      expect(rules).toHaveLength(1)
      expect(rules[0]?.source).toEqual({
        type: 'r2',
        key: expectedKey,
      })

      const artifact = await stageTargetArtifact(
        distRoot,
        binaryPath,
        target,
        rules,
        sourceRoot,
        {
          send: async (command: unknown) => {
            requests.push((command as { input: { Key: string } }).input.Key)
            return {
              Body: {
                transformToByteArray: async () => payload,
              },
            }
          },
        } as unknown as S3Client,
        fakeR2Config,
        '0.0.0-test',
      )

      expect(requests).toEqual([`artifacts/vendor/${expectedKey}`])
      expect(
        await readFile(
          join(artifact.resourcesDir, expectedRelativePath),
          'utf8',
        ),
      ).toBe(`${target.id}-bun`)
    })
  }
})

const testTarget: BuildTarget = {
  id: 'darwin-arm64',
  name: 'macOS ARM64',
  os: 'macos',
  arch: 'arm64',
  bunTarget: 'bun-darwin-arm64',
  serverBinaryName: 'browseros-server',
}

const linuxArm64Target: BuildTarget = {
  id: 'linux-arm64',
  name: 'Linux ARM64',
  os: 'linux',
  arch: 'arm64',
  bunTarget: 'bun-linux-arm64',
  serverBinaryName: 'browseros_server',
}

const linuxX64Target: BuildTarget = {
  id: 'linux-x64',
  name: 'Linux x64',
  os: 'linux',
  arch: 'x64',
  bunTarget: 'bun-linux-x64-baseline',
  serverBinaryName: 'browseros_server',
}

const windowsX64Target: BuildTarget = {
  id: 'windows-x64',
  name: 'Windows x64',
  os: 'windows',
  arch: 'x64',
  bunTarget: 'bun-windows-x64-baseline',
  serverBinaryName: 'browseros_server.exe',
}

function bunRulesForTarget(target: BuildTarget): ResourceRule[] {
  return getTargetRules(
    loadManifest(join(import.meta.dir, '../config/server-prod-resources.json')),
    target,
  ).filter(
    (rule) => rule.source.type === 'r2' && rule.name.startsWith('Bun - '),
  )
}

const migrationRule: ResourceRule = {
  name: 'Drizzle migrations',
  source: {
    type: 'local',
    path: 'apps/server/src/lib/db/migrations',
  },
  destination: 'resources/db/migrations',
  recursive: true,
  os: ['macos'],
  arch: ['arm64', 'x64'],
}

const bunRule: ResourceRule = {
  name: 'Bun - macOS ARM64',
  source: {
    type: 'r2',
    key: 'third_party/bun/bun-darwin-arm64',
  },
  destination: 'resources/bin/third_party/bun',
  os: ['macos'],
  arch: ['arm64'],
  executable: true,
}

const fakeR2Config: R2Config = {
  accountId: 'test',
  accessKeyId: 'test',
  secretAccessKey: 'test',
  bucket: 'browseros-test',
  downloadPrefix: 'artifacts/vendor',
  uploadPrefix: 'server/prod-resources',
}
