/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Continuity candidates from approvals (+ optional resume hints).
 */

import { listPendingApprovals } from '../scheduler/approvals'
import type { PiContinuityBlock } from './types'

export function continuityFromApprovals(): PiContinuityBlock[] {
  try {
    const pending = listPendingApprovals()
    return pending.slice(0, 5).map((a) => {
      const conversationQuery = a.conversationId
        ? `?conversationId=${encodeURIComponent(a.conversationId)}`
        : ''
      return {
        id: `approval-${a.id}`,
        title: 'Approval waiting',
        body:
          a.preview?.trim() ||
          a.toolName?.trim() ||
          'A scheduled action needs your approval',
        // Deep-link into Action Log so approve/deny is reachable after
        // ScheduleResults was removed from home (S13).
        route: `#/settings/action-log${conversationQuery}`,
        agentQuery: `Review pending approval ${a.id}`,
        metadata: {
          approvalId: a.id,
          toolName: a.toolName,
          kind: 'approval',
          conversationId: a.conversationId,
          approveToken: a.approveToken,
          denyToken: a.denyToken,
        },
      }
    })
  } catch {
    return []
  }
}

export function mergeContinuityBlocks(
  primary: PiContinuityBlock[],
  extras: PiContinuityBlock[],
  limit = 5,
): PiContinuityBlock[] {
  const seen = new Set(primary.map((b) => b.id))
  const out = [...primary]
  for (const e of extras) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
    if (out.length >= limit) break
  }
  return out.slice(0, limit)
}
