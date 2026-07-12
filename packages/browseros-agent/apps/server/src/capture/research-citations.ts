/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getDbHandle } from '../lib/db'

export interface ResearchCitation {
  url: string
  quote: string | null
  capturedAt: number
}

export function lookupResearchCitation(
  nodeId: string,
): ResearchCitation | null {
  const row = getDbHandle()
    .sqlite.prepare<
      { url: string; quote: string | null; captured_at: number },
      [string]
    >(
      `SELECT url, quote, captured_at
       FROM research_thread_pages
       WHERE node_id = ?
       LIMIT 1`,
    )
    .get(nodeId)
  if (!row) return null
  return {
    url: row.url,
    quote: row.quote,
    capturedAt: row.captured_at,
  }
}
