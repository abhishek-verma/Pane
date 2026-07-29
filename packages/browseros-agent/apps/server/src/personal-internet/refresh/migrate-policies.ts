/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * One-shot: sites created before operable ship stored `new-day` as kind A.
 * Site kind D (board/chart sync) never ran for those profiles — bump to D.
 */

import { logger } from '../../lib/logger'
import { listPolicies, upsertPolicy } from '../store'
import type { PiRefreshPolicy } from '../types'

export function migrateSiteNewDayKindD(): number {
  let updated = 0
  for (const row of listPolicies()) {
    if (row.targetType !== 'site') continue
    const next = bumpNewDayToD(row.policy)
    if (!next) continue
    upsertPolicy('site', row.targetId, next)
    updated += 1
  }
  if (updated > 0) {
    logger.info('pi migrated site new-day triggers to kind D', { updated })
  }
  return updated
}

/** Returns updated policy if any new-day trigger was A; else null. */
export function bumpNewDayToD(policy: PiRefreshPolicy): PiRefreshPolicy | null {
  let changed = false
  const triggers = policy.triggers.map((t) => {
    if (t.name === 'new-day' && t.kind === 'A') {
      changed = true
      return { ...t, kind: 'D' as const }
    }
    return t
  })
  if (!changed) return null
  return { ...policy, triggers }
}
