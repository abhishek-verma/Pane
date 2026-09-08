import { expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensurePrewarmDir,
  prewarmEnvOverrides,
} from '../../../../src/lib/agents/host-acp/macos-native-prewarm'

it('creates only a temporary data directory, with no security-setting mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pane-data-dir-test-'))
  try {
    const dir = await ensurePrewarmDir(root)
    expect((await stat(dir)).isDirectory()).toBe(true)
    expect(await ensurePrewarmDir(root)).toBe(dir)
    expect(prewarmEnvOverrides(dir)).toEqual({ TMPDIR: dir })
    const source = await readFile(
      new URL(
        '../../../../src/lib/agents/host-acp/macos-native-prewarm.ts',
        import.meta.url,
      ),
      'utf8',
    )
    expect(source).not.toContain('execFile')
    expect(source).not.toContain('child_process')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
