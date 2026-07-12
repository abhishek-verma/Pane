/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Proposal job — detects user activity patterns and proposes relevant widgets.
 * Also runs the demotion rule: widgets seen many times with no actions are demoted.
 *
 * Runs every 24h via setInterval in main.ts; skips when on battery if the user
 * has the pause-on-battery preference set.
 */

import { detectOnBattery, getPauseOnBatteryPref } from '../context/battery'
import { getBrowserosDir } from '../lib/browseros-dir'
import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import {
  createWidget,
  getWidgetsDir,
  listWidgets,
  setWidgetStatus,
} from './widget-store'

export const PROPOSAL_INTERVAL_MS = 24 * 60 * 60 * 1000
export const MIN_RUNS_FOR_PROPOSAL = 3
export const DEMOTION_SHOW_COUNT = 10
export const DEMOTION_DAYS = 14

export interface ProposalJobOptions {
  widgetsDir?: string
  skipBatteryCheck?: boolean
  now?: number
}

export interface ProposalJobResult {
  skipped?: string
  staged: string[]
  demoted: string[]
}

function defaultWidgetsDir(): string {
  return getWidgetsDir(getBrowserosDir())
}

export async function runProposalJob(
  options: ProposalJobOptions = {},
): Promise<ProposalJobResult> {
  if (!options.skipBatteryCheck) {
    if (getPauseOnBatteryPref() && (await detectOnBattery())) {
      return { skipped: 'battery', staged: [], demoted: [] }
    }
  }

  const widgetsDir = options.widgetsDir ?? defaultWidgetsDir()
  const now = options.now ?? Date.now()
  const staged: string[] = []
  const demoted: string[] = []

  // 1. Apply demotion rule
  const activeWidgets = await listWidgets({ status: 'active' }, widgetsDir)
  const cutoffMs = DEMOTION_DAYS * 24 * 60 * 60 * 1000
  for (const widget of activeWidgets) {
    const createdLongAgo = now - new Date(widget.createdAt).getTime() > cutoffMs
    const neverActed = widget.lastActionAt === null
    const actedLongAgo =
      widget.lastActionAt != null &&
      now - new Date(widget.lastActionAt).getTime() > cutoffMs
    if (
      widget.showCount > DEMOTION_SHOW_COUNT &&
      createdLongAgo &&
      (neverActed || actedLongAgo)
    ) {
      await setWidgetStatus(widget.id, 'demoted', widgetsDir)
      demoted.push(widget.id)
      logger.info(
        `Home widget demoted due to inactivity: ${widget.id} "${widget.title}"`,
      )
    }
  }

  // 2. Check if already at max staged proposals (1)
  const alreadyStaged = await listWidgets({ status: 'staged' }, widgetsDir)
  if (alreadyStaged.length >= 1) {
    return { staged, demoted }
  }

  // 3. Check if user already has a scheduled-type widget (active or demoted)
  const allWidgets = await listWidgets({}, widgetsDir)
  const hasScheduledWidget = allWidgets.some(
    (w) =>
      (w.source.type === 'scheduled' || w.status === 'staged') &&
      w.status !== 'archived',
  )
  if (hasScheduledWidget) {
    return { staged, demoted }
  }

  // 4. Detect recurring scheduled jobs
  const db = getDbHandle().sqlite
  const recurringRuns = db
    .prepare<
      { source_id: string | null; prompt: string; run_count: number },
      []
    >(
      `SELECT source_id, prompt, COUNT(*) as run_count
       FROM scheduled_runs
       WHERE status = 'completed' AND source_id IS NOT NULL
       GROUP BY source_id
       HAVING run_count >= ${MIN_RUNS_FOR_PROPOSAL}
       ORDER BY run_count DESC
       LIMIT 5`,
    )
    .all()

  if (recurringRuns.length > 0) {
    const top = recurringRuns[0]!
    const spec = await createWidget(
      {
        title: top.prompt.slice(0, 60),
        source: {
          type: 'scheduled',
          query: top.source_id ? `source_id:${top.source_id}` : undefined,
        },
        action: { type: 'open-route', target: '#/scheduled' },
        refreshMinutes: 5,
        createdBy: 'agent',
        status: 'staged',
        whyText: `Pane noticed this task has run ${top.run_count} times. Add it to your home for one-tap access.`,
      },
      widgetsDir,
    )
    staged.push(spec.id)
    logger.info(
      `Staged widget proposal for recurring job: "${spec.title}" (id: ${spec.id})`,
    )
  }

  return { staged, demoted }
}
