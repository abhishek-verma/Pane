/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Durable mirror for sidepanel chat turns. Memory registry is authoritative
 * while the process is alive; this table survives restarts for honesty.
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { type ChatTurnStatus, chatTurns } from '../lib/db/schema/chat-turns'
import { logger } from '../lib/logger'

export async function insertRunningChatTurn(input: {
  turnId: string
  sessionId: string
  startedAt: number
}): Promise<void> {
  try {
    await getDb().insert(chatTurns).values({
      id: input.turnId,
      sessionId: input.sessionId,
      status: 'running',
      startedAt: input.startedAt,
      endedAt: null,
      stopReason: null,
    })
  } catch (err) {
    logger.warn('Failed to insert chat_turns row', {
      turnId: input.turnId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function markChatTurnTerminal(input: {
  turnId: string
  status: Exclude<ChatTurnStatus, 'running'>
  stopReason?: string | null
}): Promise<void> {
  try {
    await getDb()
      .update(chatTurns)
      .set({
        status: input.status,
        endedAt: Date.now(),
        stopReason: input.stopReason ?? null,
      })
      .where(eq(chatTurns.id, input.turnId))
  } catch (err) {
    logger.warn('Failed to mark chat_turns terminal', {
      turnId: input.turnId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Returns a DB row still marked running (split-brain candidate). */
export async function getDbRunningChatTurn(
  sessionId: string,
): Promise<{ id: string; startedAt: number } | null> {
  try {
    const row = await getDb()
      .select({
        id: chatTurns.id,
        startedAt: chatTurns.startedAt,
      })
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.sessionId, sessionId),
          eq(chatTurns.status, 'running'),
        ),
      )
      .get()
    return row ?? null
  } catch {
    return null
  }
}

/**
 * On process boot: any `running` row is stale (memory is empty). Mark
 * interrupted so clients do not spin on a phantom active turn.
 */
export function reconcileStaleChatTurns(): number {
  try {
    const db = getDb()
    const now = Date.now()
    const result = db
      .update(chatTurns)
      .set({
        status: 'interrupted',
        endedAt: now,
        stopReason: 'server-restart',
      })
      .where(eq(chatTurns.status, 'running'))
      .run()
    const changes =
      typeof result === 'object' && result && 'changes' in result
        ? Number((result as { changes: number }).changes)
        : 0
    if (changes > 0) {
      logger.info('Reconciled stale chat turns on startup', { changes })
    }
    return changes
  } catch (err) {
    logger.warn('chat_turns boot reconcile failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return 0
  }
}

/** Repair a single split-brain running row (DB running, memory empty). */
export async function interruptDbRunningChatTurn(
  turnId: string,
  reason = 'split-brain',
): Promise<void> {
  await markChatTurnTerminal({
    turnId,
    status: 'interrupted',
    stopReason: reason,
  })
}
