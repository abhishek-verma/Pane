/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { pageRoute, siteRoute } from './paths'
import { getSite, listPagesForSite, listRecords, upsertPulse } from './store'
import type { PiPulse, PiSiteStatus, PiUrgency } from './types'

export function recomputePulse(siteId: string): PiPulse | null {
  const site = getSite(siteId)
  if (!site || site.status === 'deleted') return null

  const records = listRecords(siteId)
  const counts: Record<string, number> = {}
  const urgencies: PiUrgency[] = []

  for (const rec of records) {
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(rec.dataJson) as Record<string, unknown>
    } catch {
      data = {}
    }
    const stage = String(data.stage ?? data.status ?? rec.type ?? 'items')
    counts[stage] = (counts[stage] ?? 0) + 1
    if (data.nextAction && typeof data.nextAction === 'string') {
      const pages = listPagesForSite(siteId)
      const entityPage = pages.find(
        (p) =>
          p.kind === 'entity' &&
          p.title.includes(String(data.company ?? data.name ?? '')),
      )
      urgencies.push({
        label: String(data.nextAction),
        deepLink: entityPage
          ? pageRoute(siteId, entityPage.id)
          : siteRoute(siteId),
        agentQuery: `Follow up: ${data.nextAction}`,
        metadata: { recordId: rec.id, siteId },
      })
    }
  }

  const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`)
  const pulseLine =
    parts.length > 0 ? parts.join(' · ') : 'Empty — add your first item'

  const pulse: PiPulse = {
    siteId,
    name: site.name,
    address: siteRoute(siteId),
    pulseLine,
    counts,
    topUrgencies: urgencies.slice(0, 3),
    lastUpdatedAt: new Date().toISOString(),
    staleAt: null,
    status: site.status as PiSiteStatus,
  }

  if (site.status === 'archived') {
    // Still compute but caller should not publish to home.
  }

  upsertPulse(siteId, pulse)
  return pulse
}
