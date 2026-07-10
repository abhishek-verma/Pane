/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import { z } from 'zod'
import {
  listStagedSkillIds,
  readPromptFiles,
  readStagedSkill,
  seedPromptFilesIfMissing,
  writePromptFileAndReindex,
} from '../../memory/files'
import {
  applyPersonaTemplate,
  listPersonas,
  readPersonaMap,
  resolveSoulForBucket,
  writePersonaMap,
} from '../../memory/personas'
import { runSkillReviewJob } from '../../memory/review-job'
import {
  activateStagedSkill,
  archiveSkill,
  installSkillFromSource,
  rejectStagedSkill,
  runCurationPass,
} from '../../memory/skills'
import {
  forgetMemoryEntry,
  listEntries,
  listSkills,
  MemoryWriteRejectedError,
  writeMemoryEntry,
} from '../../memory/store'
import type { Env } from '../types'

const PutFileSchema = z.object({
  content: z.string(),
})

const ApproveSchema = z.object({
  id: z.string().min(1),
})

const ImportSchema = z
  .object({
    path: z.string().min(1).optional(),
    url: z.string().url().optional(),
    id: z.string().optional(),
  })
  .refine((v) => Boolean(v.path) !== Boolean(v.url), {
    message: 'Provide exactly one of path or url',
  })

const PersonaMapSchema = z.object({
  bucketPersonas: z.record(z.string()).optional(),
  pinned: z.string().nullable().optional(),
})

export function createMemoryRoutes() {
  return new Hono<Env>()
    .get('/files', async (c) => {
      await seedPromptFilesIfMissing()
      const files = await readPromptFiles()
      return c.json({ files })
    })
    .put('/files/:which', async (c) => {
      const which = c.req.param('which')
      if (which !== 'soul' && which !== 'user' && which !== 'memory') {
        return c.json({ error: 'which must be soul|user|memory' }, 400)
      }
      const body = PutFileSchema.parse(await c.req.json())
      try {
        await writePromptFileAndReindex(which, body.content)
      } catch (err) {
        if (err instanceof MemoryWriteRejectedError) {
          return c.json({ error: err.message, reason: err.reason }, 400)
        }
        throw err
      }
      return c.json({ ok: true })
    })
    .get('/entries', (c) => {
      const bucketId = c.req.query('bucketId') || 'default'
      const q = c.req.query('q') || undefined
      return c.json({
        entries: listEntries({ bucketId, query: q, limit: 50 }),
      })
    })
    .post('/entries', async (c) => {
      const body = z
        .object({ content: z.string().min(1), bucketId: z.string().optional() })
        .parse(await c.req.json())
      const entry = await writeMemoryEntry({
        content: body.content,
        source: 'user',
        bucketId: body.bucketId,
      })
      return c.json({ entry })
    })
    .delete('/entries', async (c) => {
      const match = c.req.query('match') || ''
      if (!match) return c.json({ error: 'match required' }, 400)
      const result = await forgetMemoryEntry(match)
      return c.json(result)
    })
    .get('/skills', (c) => {
      const status = c.req.query('status')
      return c.json({
        skills: listSkills({
          status: status
            ? (status.split(',') as never)
            : ['active', 'staged', 'flagged'],
          limit: 100,
        }),
      })
    })
    .get('/skills/staged', async (c) => {
      const ids = await listStagedSkillIds()
      const items = []
      for (const id of ids) {
        const body = await readStagedSkill(id)
        items.push({ id, body })
      }
      return c.json({ staged: items })
    })
    .post('/skills/staged/approve', async (c) => {
      const body = ApproveSchema.parse(await c.req.json())
      const result = await activateStagedSkill(body.id)
      if (!result.ok) return c.json(result, 400)
      return c.json(result)
    })
    .post('/skills/staged/reject', async (c) => {
      const body = ApproveSchema.parse(await c.req.json())
      await rejectStagedSkill(body.id)
      return c.json({ ok: true })
    })
    .post('/skills/import', async (c) => {
      const body = ImportSchema.parse(await c.req.json())
      try {
        const id = await installSkillFromSource(
          { path: body.path, url: body.url },
          {
            id: body.id,
            // User-picked path via Settings UI — not agent-controlled.
            allowAnyLocalPath: Boolean(body.path),
          },
        )
        return c.json({ id })
      } catch (err) {
        if (
          err instanceof MemoryWriteRejectedError ||
          (err instanceof Error && err.name === 'SkillFetchError')
        ) {
          return c.json({ error: err.message }, 400)
        }
        throw err
      }
    })
    .post('/skills/:id/archive', async (c) => {
      await archiveSkill(c.req.param('id'))
      return c.json({ ok: true })
    })
    .post('/review/run', async (c) => {
      const result = await runSkillReviewJob({ skipBatteryCheck: true })
      return c.json(result)
    })
    .post('/curation/run', async (c) => {
      const result = await runCurationPass()
      return c.json(result)
    })
    .get('/personas', async (c) => {
      const map = await readPersonaMap()
      return c.json({ personas: listPersonas(), map })
    })
    .put('/personas/map', async (c) => {
      const body = PersonaMapSchema.parse(await c.req.json())
      const current = await readPersonaMap()
      const next = {
        bucketPersonas: body.bucketPersonas ?? current.bucketPersonas,
        pinned: body.pinned === undefined ? current.pinned : body.pinned,
      }
      await writePersonaMap(next)
      return c.json({ map: next })
    })
    .post('/personas/apply', async (c) => {
      const body = z
        .object({
          personaId: z.string().min(1),
          bucketId: z.string().optional(),
        })
        .parse(await c.req.json())
      await applyPersonaTemplate(body.personaId, {
        bucketId: body.bucketId,
      })
      return c.json({ ok: true })
    })
    .get('/personas/resolve', async (c) => {
      const bucketId = c.req.query('bucketId') || 'default'
      const resolved = await resolveSoulForBucket(bucketId)
      return c.json(resolved)
    })
}
