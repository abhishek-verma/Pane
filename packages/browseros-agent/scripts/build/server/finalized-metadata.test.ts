import { expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuildTarget } from '@browseros/build-server-tools'
import { writeArtifactMetadata } from '../../../packages/build-server-tools/src/metadata'

it('refreshes signed bytes without hashing the metadata into itself', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pane-finalized-metadata-'))
  try {
    const target = { id: 'darwin-arm64' } as BuildTarget
    await writeFile(join(root, 'binary'), 'unsigned')
    await writeArtifactMetadata(root, target, 'test')
    await writeFile(join(root, 'binary'), 'signed')
    const path = await writeArtifactMetadata(root, target, 'test')
    const metadata = JSON.parse(await readFile(path, 'utf8'))
    expect(metadata.files).toEqual([
      {
        path: 'binary',
        size: 6,
        sha256: createHash('sha256').update('signed').digest('hex'),
      },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
