import { Hono } from 'hono'
import {
  browseWorkspaceDirectory,
  readWorkspaceFile,
} from '../services/workspace-browse'
import type { Env } from '../types'

export function createWorkspaceRoutes() {
  return new Hono<Env>()
    .get('/files', async (c) => {
      const root = c.req.query('root')
      const path = c.req.query('path') || '.'

      if (!root?.trim()) {
        return c.json({ error: 'root is required' }, 400)
      }

      try {
        const result = await browseWorkspaceDirectory(root, path)
        return c.json(result)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to browse workspace'
        return c.json({ error: message }, 400)
      }
    })
    .get('/file', async (c) => {
      const root = c.req.query('root')
      const path = c.req.query('path')

      if (!root?.trim() || !path?.trim()) {
        return c.json({ error: 'root and path are required' }, 400)
      }

      try {
        const result = await readWorkspaceFile(root, path)
        return c.json(result)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to read file'
        return c.json({ error: message }, 400)
      }
    })
}
