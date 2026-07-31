/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Build the additive `pi` block for GET /scheduler/home — never calls an LLM.
 */

import {
  continuityFromApprovals,
  mergeContinuityBlocks,
} from './continuity-sources'
import { siteRoute } from './paths'
import { recomputePulse } from './pulse'
import { getPulse, listSites, readHomePrefs } from './store'
import type { PiContinuityBlock, PiDoorway, PiHomeProjection } from './types'

function withoutDismissed(
  blocks: PiContinuityBlock[],
  dismissed: Set<string>,
): PiContinuityBlock[] {
  if (dismissed.size === 0) return blocks
  return blocks.filter((b) => !dismissed.has(b.id))
}

const DORMANT_DEMOTE = true
const STALE_DEMOTE_MS = 14 * 24 * 60 * 60 * 1000

export async function buildPiHomeProjection(): Promise<PiHomeProjection> {
  const prefs = await readHomePrefs()
  const hidden = new Set(prefs.hiddenSiteIds)
  const pinned = new Set(prefs.pinnedSiteIds)
  const now = Date.now()

  const sites = listSites({ status: ['active', 'dormant'] })
  const doorways: PiDoorway[] = []
  const propose: Array<{ siteId: string; name: string; route: string }> = []

  for (const site of sites) {
    if (hidden.has(site.id)) continue
    if (DORMANT_DEMOTE && site.status === 'dormant' && !pinned.has(site.id)) {
      continue
    }
    if (!site.doorwayEligible && !pinned.has(site.id)) {
      if (site.status === 'active') {
        propose.push({
          siteId: site.id,
          name: site.name,
          route: siteRoute(site.id),
        })
      }
      continue
    }

    let pulse = getPulse(site.id)
    if (!pulse) pulse = recomputePulse(site.id)
    if (!pulse) continue

    // Demote very stale unpinned doorways to library-only (Ship Bar / B16).
    if (!pinned.has(site.id) && pulse.lastUpdatedAt) {
      const age = now - Date.parse(pulse.lastUpdatedAt)
      if (Number.isFinite(age) && age > STALE_DEMOTE_MS) {
        continue
      }
    }

    doorways.push({
      siteId: site.id,
      name: pulse.name,
      address: pulse.address,
      pulseLine: pulse.pulseLine,
      primaryRoute: siteRoute(site.id),
      secondary: pulse.topUrgencies[0],
      lastUpdatedAt: pulse.lastUpdatedAt,
    })
  }

  doorways.sort((a, b) => {
    const ap = pinned.has(a.siteId) ? 0 : 1
    const bp = pinned.has(b.siteId) ? 0 : 1
    if (ap !== bp) return ap - bp
    return a.name.localeCompare(b.name)
  })

  const continuity = await loadContinuity(doorways)

  const libraryCount = listSites({
    status: ['active', 'dormant', 'drafting', 'archived'],
  }).length

  return {
    doorways: doorways.slice(0, 8),
    continuity,
    libraryCount,
    generatedAt: new Date().toISOString(),
    ...(propose.length > 0 ? { proposeDoorways: propose.slice(0, 3) } : {}),
  }
}

async function loadContinuity(
  doorways: PiDoorway[],
): Promise<PiContinuityBlock[]> {
  const prefs = await readHomePrefs()
  const dismissed = new Set(prefs.dismissedContinuityIds)
  const liveApprovals = withoutDismissed(continuityFromApprovals(), dismissed)
  const blocks: PiContinuityBlock[] = []

  // Home is a projection, never a cache of its own cards.  In particular, do
  // not read the legacy home-regions JSON here: treating it as an input made a
  // refresh read yesterday's cards and write them straight back forever.
  for (const d of doorways) {
    if (!d.secondary) continue
    const urgencyId = `urgency-${d.siteId}`
    if (dismissed.has(urgencyId)) continue
    blocks.push({
      id: urgencyId,
      title: d.name,
      body: d.secondary.label,
      route: d.secondary.deepLink,
      agentQuery: d.secondary.agentQuery,
      metadata: d.secondary.metadata,
    })
    if (blocks.length >= 3) break
  }

  return mergeContinuityBlocks(liveApprovals, blocks, 5)
}

/** Empty projection for error fallback — keeps /scheduler/home stable. */
export function emptyPiHomeProjection(): PiHomeProjection {
  return {
    doorways: [],
    continuity: [],
    libraryCount: 0,
    generatedAt: new Date().toISOString(),
  }
}
