import type { ToolSet } from 'ai'
import { createBashTool } from './bash'
import { createEditTool } from './edit'
import { createFindTool } from './find'
import { createGrepTool } from './grep'
import { createLsTool } from './ls'
import { createReadTool, type ReadToolOptions } from './read'
import type { Workspace } from './workspace'
import { createWriteTool } from './write'

export interface FilesystemToolSetOptions {
  read?: ReadToolOptions
}

export function buildFilesystemToolSet(
  workspace: Workspace,
  options: FilesystemToolSetOptions = {},
): ToolSet {
  const { root } = workspace
  return {
    filesystem_read: createReadTool(root, options.read),
    filesystem_write: createWriteTool(root),
    filesystem_edit: createEditTool(root),
    filesystem_bash: createBashTool(workspace),
    filesystem_grep: createGrepTool(root),
    filesystem_find: createFindTool(root),
    filesystem_ls: createLsTool(root),
  }
}
