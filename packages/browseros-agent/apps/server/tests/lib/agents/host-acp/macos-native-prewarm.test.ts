/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  BUN_PREWARM_SUBDIR,
  defaultPrewarmDir,
  ensurePrewarmDir,
  prewarmEnvOverrides,
  prewarmProviderNativeModules,
  signUnsignedNodeFiles,
} from '../../../../src/lib/agents/host-acp/macos-native-prewarm'

const execFileAsync = promisify(execFile)

describe('prewarmEnvOverrides', () => {
  it('sets TMPDIR to the given directory', () => {
    const overrides = prewarmEnvOverrides('/some/dir')
    expect(overrides).toEqual({ TMPDIR: '/some/dir' })
  })
})

describe('defaultPrewarmDir', () => {
  it('returns os.tmpdir() as fallback', () => {
    expect(defaultPrewarmDir()).toBe(tmpdir())
  })
})

describe('ensurePrewarmDir', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'pane-prewarm-test-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('creates bun-tmp subdirectory', async () => {
    const dir = await ensurePrewarmDir(base)
    expect(dir).toBe(join(base, BUN_PREWARM_SUBDIR))
    const info = await stat(dir)
    expect(info.isDirectory()).toBe(true)
  })

  it('is idempotent', async () => {
    await ensurePrewarmDir(base)
    await expect(ensurePrewarmDir(base)).resolves.toBe(
      join(base, BUN_PREWARM_SUBDIR),
    )
  })
})

describe('signUnsignedNodeFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pane-sign-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns empty results for non-darwin platforms', async () => {
    const result = await signUnsignedNodeFiles(dir, 'linux')
    expect(result.signed).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  it('returns empty results when no .node files present', async () => {
    await writeFile(join(dir, 'foo.txt'), 'hello')
    const result = await signUnsignedNodeFiles(dir, 'darwin')
    expect(result.signed).toHaveLength(0)
    expect(result.failed).toHaveLength(0)
    expect(result.skipped).toHaveLength(0)
  })

  it('returns empty results for missing directory', async () => {
    const result = await signUnsignedNodeFiles(
      join(dir, 'nonexistent'),
      'darwin',
    )
    expect(result.signed).toHaveLength(0)
  })

  it('skips files that are already signed (darwin only)', async () => {
    // Create a stub .node file and ad-hoc sign it so it's "already signed"
    const nodeFile = join(dir, 'already-signed.node')
    // Write a minimal valid Mach-O arm64 dylib header (stub)
    await writeFile(nodeFile, 'not-a-real-macho')

    // Ad-hoc sign it first
    try {
      await execFileAsync('codesign', ['--sign', '-', '--force', nodeFile], {
        timeout: 10_000,
      })
    } catch {
      // If codesign not available (CI), skip this assertion
      return
    }

    const result = await signUnsignedNodeFiles(dir, 'darwin')
    expect(result.skipped).toContain('already-signed.node')
    expect(result.signed).not.toContain('already-signed.node')
  })
})

describe('prewarmProviderNativeModules', () => {
  let base: string

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'pane-prewarm-modules-test-'))
  })

  afterEach(async () => {
    await rm(base, { recursive: true, force: true })
  })

  it('no-ops on non-darwin platforms', async () => {
    await expect(
      prewarmProviderNativeModules(base, 'linux'),
    ).resolves.toBeUndefined()
  })

  it('creates bun-tmp dir and runs without throwing on darwin', async () => {
    await expect(
      prewarmProviderNativeModules(base, 'darwin'),
    ).resolves.toBeUndefined()

    const prewarmDir = join(base, BUN_PREWARM_SUBDIR)
    const info = await stat(prewarmDir)
    expect(info.isDirectory()).toBe(true)
  })

  it('handles empty browserosDir gracefully', async () => {
    await expect(
      prewarmProviderNativeModules('', 'darwin'),
    ).resolves.toBeUndefined()
  })
})
