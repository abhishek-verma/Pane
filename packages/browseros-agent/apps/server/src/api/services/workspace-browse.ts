import type { Dirent } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  resolveWorkspacePathFromRoot,
  resolveWorkspaceRoot,
} from '../../tools/filesystem/path-boundary'

export interface WorkspaceBrowseEntry {
  name: string
  type: 'dir' | 'file'
  size?: number
}

export interface WorkspaceBrowseResult {
  path: string
  entries: WorkspaceBrowseEntry[]
}

export async function browseWorkspaceDirectory(
  root: string,
  relativePath = '.',
): Promise<WorkspaceBrowseResult> {
  const resolvedRoot = await resolveWorkspaceRoot(root)
  const resolved = await resolveWorkspacePathFromRoot(
    resolvedRoot,
    relativePath,
  )
  const entries = await readdir(resolved, { withFileTypes: true })
  const items = await collectBrowseEntries(
    resolvedRoot,
    relativePath,
    resolved,
    entries,
  )
  return { path: relativePath, entries: items }
}

export async function readWorkspaceFile(
  root: string,
  relativePath: string,
): Promise<{ path: string; content: string }> {
  const resolvedRoot = await resolveWorkspaceRoot(root)
  const resolved = await resolveWorkspacePathFromRoot(
    resolvedRoot,
    relativePath,
  )
  const info = await stat(resolved)
  if (!info.isFile()) {
    throw new Error('Path is not a file')
  }
  const content = await readFile(resolved, 'utf-8')
  return { path: relativePath, content }
}

async function collectBrowseEntries(
  root: string,
  inputPath: string,
  resolved: string,
  entries: Dirent[],
): Promise<WorkspaceBrowseEntry[]> {
  const items: WorkspaceBrowseEntry[] = []

  for (const entry of entries) {
    const childPath = join(inputPath, entry.name)
    try {
      await resolveWorkspacePathFromRoot(root, childPath)
    } catch {
      continue
    }

    if (entry.isDirectory()) {
      items.push({ name: entry.name, type: 'dir' })
      continue
    }

    try {
      const info = await stat(join(resolved, entry.name))
      items.push({ name: entry.name, type: 'file', size: info.size })
    } catch {
      items.push({ name: entry.name, type: 'file', size: 0 })
    }
  }

  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

  return items
}
