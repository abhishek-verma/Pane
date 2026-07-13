/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { ensureDefaultBucket } from '@browseros/context-graph/repo'
import type { GraphSqlDatabase } from '@browseros/context-graph/types'
import { getDbHandle } from '../lib/db'

export interface DomainGrant {
  domain: string
  bucketId: string
  allowed: boolean
  updatedAt: number
}

function sqlite(): GraphSqlDatabase {
  return getDbHandle().sqlite as unknown as GraphSqlDatabase
}

export function listGrants(
  bucketId = DEFAULT_BUCKET_ID,
  options: { deniedOnly?: boolean } = {},
): DomainGrant[] {
  ensureDefaultBucket(sqlite())
  const whereClause = options.deniedOnly
    ? 'WHERE bucket_id = ? AND allowed = 0'
    : 'WHERE bucket_id = ?'
  const rows = sqlite()
    .prepare<{
      domain: string
      bucket_id: string
      allowed: number
      updated_at: number
    }>(
      `SELECT domain, bucket_id, allowed, updated_at
       FROM domain_grants ${whereClause}
       ORDER BY domain`,
    )
    .all(bucketId)
  return rows.map((r) => ({
    domain: r.domain,
    bucketId: r.bucket_id,
    allowed: r.allowed !== 0,
    updatedAt: r.updated_at,
  }))
}

export function setGrant(
  domain: string,
  allowed: boolean,
  bucketId = DEFAULT_BUCKET_ID,
): DomainGrant {
  ensureDefaultBucket(sqlite())
  const normalized = domain.trim().toLowerCase()
  const updatedAt = Date.now()
  sqlite()
    .prepare(
      `INSERT INTO domain_grants (domain, bucket_id, allowed, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(domain, bucket_id) DO UPDATE SET
         allowed = excluded.allowed,
         updated_at = excluded.updated_at`,
    )
    .run(normalized, bucketId, allowed ? 1 : 0, updatedAt)
  return { domain: normalized, bucketId, allowed, updatedAt }
}

export function getDeniedHosts(bucketId = DEFAULT_BUCKET_ID): Set<string> {
  const rows = sqlite()
    .prepare<{ domain: string }>(
      `SELECT domain FROM domain_grants
       WHERE bucket_id = ? AND allowed = 0`,
    )
    .all(bucketId)
  return new Set(rows.map((r) => r.domain.toLowerCase()))
}

/** Record an implicit allow for a visited host if no grant row exists. */
export function ensureImplicitAllow(
  domain: string,
  bucketId = DEFAULT_BUCKET_ID,
): void {
  const normalized = domain.trim().toLowerCase()
  if (!normalized) return
  ensureDefaultBucket(sqlite())
  const existing = sqlite()
    .prepare<{ domain: string }>(
      `SELECT domain FROM domain_grants WHERE domain = ? AND bucket_id = ?`,
    )
    .get(normalized, bucketId)
  if (existing) return
  setGrant(normalized, true, bucketId)
}

export function listVisitedDomains(bucketId = DEFAULT_BUCKET_ID): string[] {
  const rows = sqlite()
    .prepare<{ uri: string | null }>(
      `SELECT DISTINCT uri FROM graph_nodes
       WHERE bucket_id = ? AND kind IN ('page', 'tab') AND uri IS NOT NULL`,
    )
    .all(bucketId)
  const hosts = new Set<string>()
  for (const row of rows) {
    if (!row.uri) continue
    try {
      const host = new URL(row.uri).hostname.toLowerCase()
      if (host) hosts.add(host)
    } catch {
      // ignore non-URL uris (tab:…)
    }
  }
  return [...hosts].sort()
}
