/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Process-local focus lease for PI lazy entity materialize (one BTF at a time).
 */

import {
  getDbRunningChatTurn,
  markChatTurnTerminal,
} from '../agent/chat-turns-store'
import { conversationTurnRegistry } from '../agent/conversation-turn-registry'
import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import { getScheduledRun, updateRunStatus } from '../scheduler/run-executor'

export type PiFocus = {
  siteId: string
  pageId: string
  entityKey: string
  runId: string | null
  conversationId: string | null
  acquiredAt: number
}

let current: PiFocus | null = null

export function getPiFocus(): PiFocus | null {
  return current
}

export function cancelMaterializeRun(runId: string, reason: string): void {
  const run = getScheduledRun(runId)
  if (!run) return
  if (
    run.status !== 'pending' &&
    run.status !== 'running' &&
    run.status !== 'awaiting-approval'
  ) {
    return
  }
  if (run.conversationId) {
    // Mirror ChatService.cancelTurn: registry cancel alone leaves chat_turns
    // stuck at status=running when the SDK never reaches onFinish (hung tool).
    const turn = conversationTurnRegistry.getActiveFor(run.conversationId)
    if (turn?.status === 'running') {
      conversationTurnRegistry.cancel(turn.turnId, reason)
      void markChatTurnTerminal({
        turnId: turn.turnId,
        status: 'cancelled',
        stopReason: reason,
      })
    } else {
      void getDbRunningChatTurn(run.conversationId).then((row) => {
        if (!row) return
        void markChatTurnTerminal({
          turnId: row.id,
          status: 'cancelled',
          stopReason: reason,
        })
      })
    }
  }
  updateRunStatus(runId, {
    status: 'cancelled',
    error: reason,
    completedAt: Date.now(),
  })
  logger.info('pi materialize run cancelled', { runId, reason })
}

/** Cancel active/pending pi-materialize runs for a site except optional keepPageId. */
export function cancelSiteMaterializeRuns(
  siteId: string,
  keepPageId?: string,
): void {
  const rows = getDbHandle()
    .sqlite.prepare(
      `SELECT id, source_id, status FROM scheduled_runs
       WHERE source = 'pi-materialize'
         AND status IN ('pending', 'running', 'awaiting-approval')`,
    )
    .all() as Array<{ id: string; source_id: string | null; status: string }>

  for (const row of rows) {
    if (keepPageId && row.source_id === keepPageId) continue
    // Only cancel runs whose page belongs to this site (sourceId is pageId).
    const page = getDbHandle()
      .sqlite.prepare(`SELECT site_id FROM pi_pages WHERE id = ?`)
      .get(row.source_id) as { site_id: string | null } | undefined
    if (!page || page.site_id !== siteId) continue
    cancelMaterializeRun(row.id, 'pi-focus-switched')
  }
}

export function acquirePiFocus(input: {
  siteId: string
  pageId: string
  entityKey: string
  runId?: string | null
}): PiFocus {
  const prev = current
  if (prev && (prev.pageId !== input.pageId || prev.siteId !== input.siteId)) {
    if (prev.runId) {
      cancelMaterializeRun(prev.runId, 'pi-focus-switched')
    }
    // Drain leftovers on the previous site too (cross-site switch).
    if (prev.siteId !== input.siteId) {
      cancelSiteMaterializeRuns(prev.siteId)
    }
    cancelSiteMaterializeRuns(input.siteId, input.pageId)
  } else if (!prev) {
    cancelSiteMaterializeRuns(input.siteId, input.pageId)
  }

  const samePage =
    Boolean(prev) &&
    prev!.pageId === input.pageId &&
    prev!.siteId === input.siteId
  current = {
    siteId: input.siteId,
    pageId: input.pageId,
    entityKey: input.entityKey,
    // Never inherit a sibling/previous page's runId after a focus switch.
    runId: input.runId ?? (samePage ? (prev?.runId ?? null) : null),
    conversationId: samePage ? (prev?.conversationId ?? null) : null,
    acquiredAt: Date.now(),
  }
  return current
}

export function setPiFocusRun(
  runId: string | null,
  conversationId?: string | null,
): void {
  if (!current) return
  current = {
    ...current,
    runId,
    conversationId:
      conversationId !== undefined ? conversationId : current.conversationId,
  }
}

export function releasePiFocus(options?: {
  siteId?: string
  pageId?: string
}): PiFocus | null {
  const prev = current
  if (!prev) return null
  if (options?.siteId && prev.siteId !== options.siteId) return prev
  if (options?.pageId && prev.pageId !== options.pageId) return prev
  // Clear the lease only. Do not cancel BTF — EntityPage unmount / Watch /
  // brief navigation used to kill in-flight materialize (pi-focus-released)
  // and leave Watch on a dead turn. Switching entities still cancels via
  // acquirePiFocus → pi-focus-switched.
  current = null
  return prev
}

/** Test helper */
export function resetPiFocusForTests(): void {
  current = null
}
