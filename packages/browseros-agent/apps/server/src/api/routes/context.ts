/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { ensureDefaultBucket } from '@browseros/context-graph/repo'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  getPauseOnBatteryPref,
  setPauseOnBatteryPref,
} from '../../context/battery'
import {
  ensureImplicitAllow,
  getDeniedHosts,
  listGrants,
  listVisitedDomains,
  setGrant,
} from '../../context/grants'
import { getIngestPauseReason, isIngestPaused } from '../../context/ingest'
import {
  graphCurrentWork,
  graphDeleteNodes,
  graphListNodes,
} from '../../context/repo'
import { getDbHandle } from '../../lib/db'
import { hybridSearch } from '../../retrieval/hybrid'
import type { Env } from '../types'

const PutGrantSchema = z.object({
  domain: z.string().min(1),
  allowed: z.boolean(),
  bucketId: z.string().optional(),
})

const CreateBucketSchema = z.object({
  name: z.string().min(1),
  kind: z
    .enum(['general', 'work', 'personal', 'project', 'research', 'meeting'])
    .optional(),
  id: z.string().optional(),
})

const GraphNodeKindSchema = z.enum([
  'tab',
  'page',
  'workspace',
  'file',
  'terminal_session',
  'agent_run',
  'task',
  'meeting',
  'research_page',
  'research_thread',
])

const DeleteNodesSchema = z.object({
  nodeIds: z.array(z.string().min(1)).min(1).max(200),
})

export function createContextRoutes() {
  return new Hono<Env>()
    .get('/current', (c) => {
      const bucketId = c.req.query('bucketId') || DEFAULT_BUCKET_ID
      ensureDefaultBucket(getDbHandle().sqlite as never)
      const denied = getDeniedHosts(bucketId)
      const work = graphCurrentWork(bucketId, { deniedHosts: denied })
      return c.json({
        bucketId,
        work,
        indexingPaused: isIngestPaused(),
        pauseReason: getIngestPauseReason(),
      })
    })
    .get('/search', async (c) => {
      const bucketId = c.req.query('bucketId') || DEFAULT_BUCKET_ID
      const q = c.req.query('q') || ''
      const limit = Number(c.req.query('limit') || '8')
      ensureDefaultBucket(getDbHandle().sqlite as never)
      const result = await hybridSearch(q, { bucketId, limit })
      return c.json({
        bucketId,
        query: q,
        mode: result.mode,
        suggestions: result.suggestions,
        snippets: result.hits.map((h) => ({
          nodeId: h.sourceId,
          bucketId,
          kind: h.kind,
          title: h.title,
          uri: h.uri,
          snippet: h.snippet,
          sourceKind: h.sourceKind,
          score: h.score,
        })),
      })
    })
    .get('/nodes', (c) => {
      const bucketId = c.req.query('bucketId') || DEFAULT_BUCKET_ID
      const kindResult = GraphNodeKindSchema.safeParse(c.req.query('kind'))
      if (!kindResult.success) {
        return c.json({ error: 'invalid kind' }, 400)
      }
      const limit = Number(c.req.query('limit') || '20')
      const offset = Number(c.req.query('offset') || '0')
      ensureDefaultBucket(getDbHandle().sqlite as never)
      const denied = getDeniedHosts(bucketId)
      const page = graphListNodes(bucketId, kindResult.data, {
        deniedHosts: denied,
        limit,
        offset,
      })
      return c.json(page)
    })
    .delete('/nodes', async (c) => {
      const body = DeleteNodesSchema.parse(await c.req.json())
      graphDeleteNodes(body.nodeIds)
      return c.json({ deleted: body.nodeIds.length })
    })
    .get('/grants', (c) => {
      const bucketId = c.req.query('bucketId') || DEFAULT_BUCKET_ID
      const deniedOnly = c.req.query('deniedOnly') === 'true'
      ensureDefaultBucket(getDbHandle().sqlite as never)
      if (!deniedOnly) {
        const visited = listVisitedDomains(bucketId)
        for (const host of visited) {
          ensureImplicitAllow(host, bucketId)
        }
      }
      return c.json({
        bucketId,
        grants: listGrants(bucketId, { deniedOnly }),
        visitedDomains: deniedOnly ? [] : listVisitedDomains(bucketId),
      })
    })
    .put('/grants', async (c) => {
      const body = PutGrantSchema.parse(await c.req.json())
      const grant = setGrant(
        body.domain,
        body.allowed,
        body.bucketId || DEFAULT_BUCKET_ID,
      )
      return c.json({ grant })
    })
    .get('/buckets', (c) => {
      ensureDefaultBucket(getDbHandle().sqlite as never)
      const rows = getDbHandle()
        .sqlite.query<
          { id: string; name: string; kind: string; created_at: number },
          []
        >('SELECT id, name, kind, created_at FROM buckets ORDER BY name')
        .all()
      return c.json({
        buckets: rows.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          createdAt: r.created_at,
        })),
      })
    })
    .post('/buckets', async (c) => {
      const body = CreateBucketSchema.parse(await c.req.json())
      ensureDefaultBucket(getDbHandle().sqlite as never)
      const id =
        body.id ||
        body.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') ||
        crypto.randomUUID()
      const createdAt = Date.now()
      getDbHandle()
        .sqlite.prepare(
          `INSERT INTO buckets (id, name, kind, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run(id, body.name, body.kind ?? 'general', createdAt)
      return c.json({
        bucket: {
          id,
          name: body.name,
          kind: body.kind ?? 'general',
          createdAt,
        },
      })
    })
    .get('/settings', (c) => {
      return c.json({
        pauseOnBattery: getPauseOnBatteryPref(),
      })
    })
    .put('/settings', async (c) => {
      const body = z
        .object({ pauseOnBattery: z.boolean() })
        .parse(await c.req.json())
      setPauseOnBatteryPref(body.pauseOnBattery)
      return c.json({ pauseOnBattery: getPauseOnBatteryPref() })
    })
}
