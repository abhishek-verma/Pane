/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Index granted workspace markdown/text files into the graph + embed queue.
 */

import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { graphUpsertNode } from '../context/repo'
import { logger } from '../lib/logger'
import { enqueueEmbed } from './queue'

const TEXT_EXT = new Set([
  '.md',
  '.txt',
  '.markdown',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.yaml',
  '.yml',
  '.toml',
])

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.obsidian',
  '.hindsight',
  '.DS_Store',
])

const MAX_FILE_BYTES = 64 * 1024
const MAX_FILES = 200

async function* walk(
  dir: string,
  root: string,
): AsyncGenerator<{ abs: string; rel: string }> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    if (SKIP_DIRS.has(name)) continue
    const abs = join(dir, name)
    if (entry.isDirectory()) {
      yield* walk(abs, root)
    } else if (entry.isFile()) {
      const rel = relative(root, abs)
      const ext = name.includes('.')
        ? `.${name.split('.').pop()?.toLowerCase()}`
        : ''
      if (!TEXT_EXT.has(ext)) continue
      yield { abs, rel }
    }
  }
}

/** Crawl a workspace root and upsert file nodes + embed queue entries. */
export async function indexWorkspaceFiles(options: {
  root: string
  bucketId?: string
  limit?: number
}): Promise<number> {
  const bucketId = options.bucketId ?? DEFAULT_BUCKET_ID
  const limit = options.limit ?? MAX_FILES
  let count = 0

  graphUpsertNode({
    bucketId,
    kind: 'workspace',
    title: options.root.split('/').pop() ?? 'workspace',
    uri: options.root,
    provenance: 'system:workspace-index',
    matchByUri: true,
  })

  for await (const file of walk(options.root, options.root)) {
    if (count >= limit) break
    try {
      const st = await stat(file.abs)
      if (st.size > MAX_FILE_BYTES) continue
      const body = await readFile(file.abs, 'utf8')
      const chunk = body.slice(0, 4000)
      const node = graphUpsertNode({
        bucketId,
        kind: 'file',
        title: file.rel.split('/').pop() ?? file.rel,
        uri: file.rel,
        summary: chunk,
        provenance: 'system:workspace-index',
        matchByUri: true,
      })
      enqueueEmbed({
        bucketId,
        sourceKind: 'graph',
        sourceId: node.id,
        kind: 'file',
        title: node.title,
        uri: node.uri,
        text: [node.title, node.uri, chunk].filter(Boolean).join('\n'),
      })
      count++
    } catch (err) {
      logger.debug('workspace file index skip', {
        path: file.rel,
        err: String(err),
      })
    }
  }
  return count
}
