/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Unattended approval-over-channel. Never auto-approves on silence —
 * timeout skips the step so the agent can continue.
 */

import { eq } from 'drizzle-orm'
import { getDb } from '../lib/db'
import {
  type PendingApprovalRow,
  pendingApprovals,
} from '../lib/db/schema/pending-approvals'
import { logger } from '../lib/logger'
import { notifyApproval } from '../reach/notify'

/** Background agents: short window then continue without executing. */
export const DEFAULT_APPROVAL_TIMEOUT_MS = 2 * 60 * 1000

/**
 * External MCP clients (Claude Code, Cursor, etc.) blocking on a consequential
 * tool call: a human is presumably at their machine driving the session, but
 * needs time to notice the push notification / open the approvals page.
 * Longer than DEFAULT_APPROVAL_TIMEOUT_MS since nothing else in the run
 * proceeds while the HTTP request is held open.
 */
export const MCP_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

/** Wall clock when this process loaded — used to detect pre-restart orphans. */
const PROCESS_STARTED_AT = Date.now()

export type ApprovalResolution = 'approved' | 'denied' | 'timeout'

export interface PendingApproval {
  id: string
  runId: string
  conversationId: string | null
  toolCallId: string
  toolName: string
  consequenceClass: string
  preview: string
  approveToken: string
  denyToken: string
  status: 'pending' | 'approved' | 'denied' | 'timeout'
  createdAt: number
  expiresAt: number
  resolvedAt: number | null
}

export type ResolveByTokenResult = {
  approval: PendingApproval
  resolution: ApprovalResolution
  /** False when the in-memory waiter is gone (restart / already timed out). */
  resumed: boolean
}

function newToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

function rowToApproval(row: PendingApprovalRow): PendingApproval {
  return {
    id: row.id,
    runId: row.runId,
    conversationId: row.conversationId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    consequenceClass: row.consequenceClass,
    preview: row.previewJson,
    approveToken: row.approveToken,
    denyToken: row.denyToken,
    status: row.status as PendingApproval['status'],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt,
  }
}

export function createPendingApproval(input: {
  runId: string
  conversationId?: string | null
  toolCallId: string
  toolName: string
  consequenceClass: string
  preview: string
  timeoutMs?: number
}): PendingApproval {
  const now = Date.now()
  const row: PendingApprovalRow = {
    id: `pa_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    runId: input.runId,
    conversationId: input.conversationId ?? null,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    consequenceClass: input.consequenceClass,
    previewJson: input.preview,
    approveToken: newToken(),
    denyToken: newToken(),
    status: 'pending',
    createdAt: now,
    expiresAt: now + (input.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS),
    resolvedAt: null,
  }
  getDb().insert(pendingApprovals).values(row).run()
  return rowToApproval(row)
}

export function getPendingApproval(id: string): PendingApproval | null {
  const row = getDb()
    .select()
    .from(pendingApprovals)
    .where(eq(pendingApprovals.id, id))
    .get()
  return row ? rowToApproval(row) : null
}

export function findPendingByToken(token: string): PendingApproval | null {
  const rows = getDb().select().from(pendingApprovals).all()
  for (const row of rows) {
    if (row.approveToken === token || row.denyToken === token) {
      return rowToApproval(row)
    }
  }
  return null
}

/**
 * Mark past-expiresAt rows as timeout, and expire orphans left from a prior
 * process (server restart drops in-memory waiters).
 */
export function expireStalePendingApprovals(now = Date.now()): number {
  const rows = getDb().select().from(pendingApprovals).all()
  let n = 0
  for (const row of rows) {
    if (row.status !== 'pending') continue
    const pastExpiry = row.expiresAt <= now
    const orphanFromPriorProcess = row.createdAt < PROCESS_STARTED_AT
    if (!pastExpiry && !orphanFromPriorProcess) continue
    getDb()
      .update(pendingApprovals)
      .set({ status: 'timeout', resolvedAt: now })
      .where(eq(pendingApprovals.id, row.id))
      .run()
    n += 1
  }
  return n
}

export function listPendingApprovals(): PendingApproval[] {
  expireStalePendingApprovals()
  return getDb()
    .select()
    .from(pendingApprovals)
    .all()
    .map(rowToApproval)
    .filter((a) => a.status === 'pending')
}

function resolveApproval(
  id: string,
  status: 'approved' | 'denied' | 'timeout',
): PendingApproval | null {
  const existing = getPendingApproval(id)
  if (!existing) return null
  if (existing.status !== 'pending') return existing
  const now = Date.now()
  getDb()
    .update(pendingApprovals)
    .set({ status, resolvedAt: now })
    .where(eq(pendingApprovals.id, id))
    .run()
  return { ...existing, status, resolvedAt: now }
}

/** Channel waiters keyed by approval id */
const waiters = new Map<
  string,
  {
    resolve: (r: ApprovalResolution) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

export function hasActiveWaiter(approvalId: string): boolean {
  return waiters.has(approvalId)
}

/**
 * Resolve by approve/deny token. Returns null if token unknown.
 * Cannot set __promoted — callers must use the returned status through
 * the gate wait path.
 */
export function resolveByToken(token: string): ResolveByTokenResult | null {
  const approval = findPendingByToken(token)
  if (!approval) return null
  if (approval.status !== 'pending') {
    return {
      approval,
      resolution:
        approval.status === 'approved'
          ? 'approved'
          : approval.status === 'denied'
            ? 'denied'
            : 'timeout',
      resumed: false,
    }
  }
  if (token === approval.approveToken) {
    const updated = resolveApproval(approval.id, 'approved')!
    return {
      approval: updated,
      resolution: 'approved',
      resumed: hasActiveWaiter(approval.id),
    }
  }
  if (token === approval.denyToken) {
    const updated = resolveApproval(approval.id, 'denied')!
    return {
      approval: updated,
      resolution: 'denied',
      resumed: hasActiveWaiter(approval.id),
    }
  }
  return null
}

export function signalApprovalResolved(
  approvalId: string,
  resolution: ApprovalResolution,
): void {
  const waiter = waiters.get(approvalId)
  if (waiter) {
    clearTimeout(waiter.timer)
    waiters.delete(approvalId)
    waiter.resolve(resolution)
  }
}

/**
 * Create pending approval, notify via reach, block until approve/deny/timeout.
 * Never treats silence as approve — timeout skips the step.
 */
export async function requestChannelApproval(input: {
  runId: string
  conversationId?: string | null
  toolCallId: string
  toolName: string
  consequenceClass: string
  preview: string
  timeoutMs?: number
  /** Inject for tests — skip real reach */
  notify?: typeof notifyApproval
  /** Inject for tests — skip real wait */
  waitMs?: number
}): Promise<{ approval: PendingApproval; resolution: ApprovalResolution }> {
  const approval = createPendingApproval(input)
  const notify = input.notify ?? notifyApproval

  try {
    await notify({
      runId: input.runId,
      toolName: input.toolName,
      preview: input.preview,
      approveToken: approval.approveToken,
      denyToken: approval.denyToken,
    })
  } catch (err) {
    logger.warn('approval reach notify failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS
  const resolution = await new Promise<ApprovalResolution>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(approval.id)
      resolveApproval(approval.id, 'timeout')
      resolve('timeout')
    }, input.waitMs ?? timeoutMs)
    waiters.set(approval.id, { resolve, timer })
  })

  return { approval: getPendingApproval(approval.id) ?? approval, resolution }
}

/** Handle inbound `/approve <token>` or `/deny <token>` text. */
export function handleApprovalInboundText(text: string): {
  handled: boolean
  resolution?: ApprovalResolution
  approval?: PendingApproval
  resumed?: boolean
} {
  const trimmed = text.trim()
  const approveMatch = trimmed.match(/^\/?approve\s+(\S+)/i)
  const denyMatch = trimmed.match(/^\/?deny\s+(\S+)/i)
  const emailApprove = trimmed.match(/^APPROVE\s+(\S+)/i)
  const emailDeny = trimmed.match(/^DENY\s+(\S+)/i)

  const token =
    approveMatch?.[1] ?? denyMatch?.[1] ?? emailApprove?.[1] ?? emailDeny?.[1]
  if (!token) return { handled: false }

  const wantDeny = Boolean(denyMatch || emailDeny)
  const found = findPendingByToken(token)
  if (!found) return { handled: true }

  // Enforce token direction — approve token cannot deny and vice versa.
  if (wantDeny && token !== found.denyToken) {
    return { handled: true, approval: found }
  }
  if (!wantDeny && token !== found.approveToken) {
    return { handled: true, approval: found }
  }

  const result = resolveByToken(token)
  if (!result) return { handled: true }
  signalApprovalResolved(result.approval.id, result.resolution)
  return {
    handled: true,
    resolution: result.resolution,
    approval: result.approval,
    resumed: result.resumed,
  }
}

/** Side-channel for gate execute: channel-approved fingerprints. */
const channelOutcomes = new Map<
  string,
  { resolution: ApprovalResolution; at: number }
>()

export function channelOutcomeKey(
  runId: string,
  toolName: string,
  argsFingerprint: string,
): string {
  return `${runId}:${toolName}:${argsFingerprint}`
}

export function setChannelOutcome(
  key: string,
  resolution: ApprovalResolution,
): void {
  channelOutcomes.set(key, { resolution, at: Date.now() })
}

export function getChannelOutcome(key: string): ApprovalResolution | null {
  return channelOutcomes.get(key)?.resolution ?? null
}

export function clearChannelOutcomes(): void {
  channelOutcomes.clear()
  for (const w of waiters.values()) clearTimeout(w.timer)
  waiters.clear()
}
