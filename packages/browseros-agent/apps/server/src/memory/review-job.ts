/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Background review: draft staged skills from repeated successful workflows.
 * Schedule: server-side setInterval from Application.initCoreServices (not a
 * second scheduler product). Pause-on-battery via context/battery.
 */

import { createHash, randomUUID } from 'node:crypto'
import { DEFAULT_BUCKET_ID } from '@browseros/memory/constants'
import { detectOnBattery, getPauseOnBatteryPref } from '../context/battery'
import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import { writeStagedSkill } from './files'
import { upsertSkillRecord } from './store'

export const REVIEW_MAX_EVENTS = 200
export const REVIEW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const REVIEW_MIN_TOOL_CALLS = 5
export const REVIEW_REPEAT_COUNT = 2
export const REVIEW_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface GraphEventRow {
  id: string
  bucket_id: string
  run_id: string | null
  tool_name: string | null
  payload_json: string
  created_at: number
}

export interface WorkflowCandidate {
  signature: string
  runIds: string[]
  toolNames: string[]
  toolCallCount: number
  bucketId: string
}

export interface ReviewJobOptions {
  minToolCalls?: number
  repeatCount?: number
  maxEvents?: number
  maxAgeMs?: number
  now?: number
  /** Injected drafter for tests; production may skip when no model. */
  draftSkill?: (candidate: WorkflowCandidate) => Promise<string | null>
  memoriesRoot?: string
  skipBatteryCheck?: boolean
}

export interface ReviewJobResult {
  skipped?: string
  considered: number
  staged: string[]
}

function loadRecentEvents(
  maxEvents: number,
  maxAgeMs: number,
  now: number,
): GraphEventRow[] {
  const cutoff = now - maxAgeMs
  return getDbHandle()
    .sqlite.prepare(
      `SELECT id, bucket_id, run_id, tool_name, payload_json, created_at
       FROM graph_events
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(cutoff, maxEvents) as GraphEventRow[]
}

/** Group events by run_id and build a tool-sequence signature. */
export function extractWorkflowCandidates(
  events: GraphEventRow[],
  options: { minToolCalls: number; repeatCount: number },
): WorkflowCandidate[] {
  const byRun = new Map<string, GraphEventRow[]>()
  for (const ev of events) {
    if (!ev.run_id || !ev.tool_name) continue
    const list = byRun.get(ev.run_id) ?? []
    list.push(ev)
    byRun.set(ev.run_id, list)
  }

  const signatureRuns = new Map<
    string,
    { runIds: string[]; toolNames: string[]; bucketId: string }
  >()

  for (const [runId, runEvents] of byRun) {
    const ordered = [...runEvents].sort((a, b) => a.created_at - b.created_at)
    const toolNames = ordered
      .map((e) => e.tool_name)
      .filter((t): t is string => !!t)
    if (toolNames.length < options.minToolCalls) continue
    const signature = toolNames.join('>')
    const existing = signatureRuns.get(signature)
    if (existing) {
      existing.runIds.push(runId)
    } else {
      signatureRuns.set(signature, {
        runIds: [runId],
        toolNames,
        bucketId: ordered[0]?.bucket_id ?? DEFAULT_BUCKET_ID,
      })
    }
  }

  const candidates: WorkflowCandidate[] = []
  for (const [signature, data] of signatureRuns) {
    if (data.runIds.length < options.repeatCount) continue
    candidates.push({
      signature,
      runIds: data.runIds,
      toolNames: data.toolNames,
      toolCallCount: data.toolNames.length,
      bucketId: data.bucketId,
    })
  }
  return candidates
}

function defaultDraft(candidate: WorkflowCandidate): string {
  const id = createHash('sha1')
    .update(candidate.signature)
    .digest('hex')
    .slice(0, 12)
  const name = `workflow-${id}`
  return `---
name: ${name}
description: Repeated workflow (${candidate.toolNames.slice(0, 4).join(' → ')})
---

# ${name}

Detected from ${candidate.runIds.length} successful runs with ≥${candidate.toolCallCount} tool calls.

## Steps
${candidate.toolNames.map((t, i) => `${i + 1}. Use \`${t}\``).join('\n')}
`
}

export async function runSkillReviewJob(
  options: ReviewJobOptions = {},
): Promise<ReviewJobResult> {
  if (!options.skipBatteryCheck && getPauseOnBatteryPref()) {
    const onBattery = await detectOnBattery()
    if (onBattery === true) {
      logger.info('skill review skipped: on battery')
      return { skipped: 'battery', considered: 0, staged: [] }
    }
  }

  const now = options.now ?? Date.now()
  const minToolCalls = options.minToolCalls ?? REVIEW_MIN_TOOL_CALLS
  const repeatCount = options.repeatCount ?? REVIEW_REPEAT_COUNT
  const maxEvents = options.maxEvents ?? REVIEW_MAX_EVENTS
  const maxAgeMs = options.maxAgeMs ?? REVIEW_MAX_AGE_MS

  const events = loadRecentEvents(maxEvents, maxAgeMs, now)
  // Property: never feed more than maxEvents into extraction.
  if (events.length > maxEvents) {
    throw new Error('review window exceeded hard cap')
  }

  const candidates = extractWorkflowCandidates(events, {
    minToolCalls,
    repeatCount,
  })

  const draft =
    options.draftSkill ??
    (async (c) => {
      // No cheaper model wired by default — deterministic draft is enough for
      // staging; production can inject an LLM drafter later.
      logger.info('skill review using template drafter (no model configured)')
      return defaultDraft(c)
    })

  const staged: string[] = []
  for (const candidate of candidates) {
    const body = await draft(candidate)
    if (!body) continue
    const skillId =
      body.match(/^name:\s*(.+)$/m)?.[1]?.trim() ??
      `staged-${randomUUID().slice(0, 8)}`
    const safeId = skillId.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
    await writeStagedSkill(safeId, body, options.memoriesRoot)
    upsertSkillRecord({
      id: safeId,
      name: safeId,
      description:
        body.match(/^description:\s*(.+)$/m)?.[1]?.trim() ??
        'Staged workflow skill',
      provenance: 'agent-written',
      sourceRun: candidate.runIds[0] ?? null,
      bucketId: candidate.bucketId,
      status: 'staged',
    })
    staged.push(safeId)
  }

  return { considered: candidates.length, staged }
}

let reviewTimer: ReturnType<typeof setInterval> | null = null

export function startMemoryReviewMonitor(): void {
  if (reviewTimer) return
  reviewTimer = setInterval(() => {
    void runSkillReviewJob().catch((err) => {
      logger.warn('skill review job failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, REVIEW_INTERVAL_MS)
  // Don't keep the process alive solely for the review timer.
  if (typeof reviewTimer === 'object' && 'unref' in reviewTimer) {
    reviewTimer.unref()
  }
}
