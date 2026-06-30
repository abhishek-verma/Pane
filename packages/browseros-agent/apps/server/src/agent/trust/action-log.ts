import type { ConsequenceClass } from '@browseros/shared/trust/consequence-class'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../lib/db'
import {
  type ActionLogDecision,
  actionLog,
} from '../../lib/db/schema/action-log'
import { logger } from '../../lib/logger'

const OUTPUT_SUMMARY_MAX = 500

export interface ActionLogWriteParams {
  runId: string
  conversationId: string
  toolName: string
  args: Record<string, unknown>
  consequenceClass: ConsequenceClass
  decision: ActionLogDecision
  outputSummary?: string
}

export async function writeActionLogEntry(
  params: ActionLogWriteParams,
): Promise<void> {
  const argsForLog = { ...params.args }
  delete argsForLog.__promoted

  await getDb()
    .insert(actionLog)
    .values({
      id: crypto.randomUUID(),
      runId: params.runId,
      conversationId: params.conversationId,
      toolName: params.toolName,
      argsJson: JSON.stringify(argsForLog),
      consequenceClass: params.consequenceClass,
      decision: params.decision,
      outputSummary: params.outputSummary?.slice(0, OUTPUT_SUMMARY_MAX),
      createdAt: Date.now(),
    })
    .run()
}

export async function listActionLogEntries(filters: {
  conversationId?: string
  runId?: string
  consequenceClass?: string
  limit?: number
}) {
  const conditions = []
  if (filters.conversationId) {
    conditions.push(eq(actionLog.conversationId, filters.conversationId))
  }
  if (filters.runId) {
    conditions.push(eq(actionLog.runId, filters.runId))
  }
  if (filters.consequenceClass) {
    conditions.push(eq(actionLog.consequenceClass, filters.consequenceClass))
  }

  return getDb()
    .select()
    .from(actionLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(actionLog.createdAt))
    .limit(filters.limit ?? 200)
    .all()
}

export function logGateDecision(
  toolName: string,
  args: Record<string, unknown>,
  ctx: {
    runId?: string
    conversationId?: string
  },
  consequenceClass: ConsequenceClass,
  decision: ActionLogDecision,
  outputSummary?: string,
): void {
  if (!ctx.runId || !ctx.conversationId) return

  writeActionLogEntry({
    runId: ctx.runId,
    conversationId: ctx.conversationId,
    toolName,
    args,
    consequenceClass,
    decision,
    outputSummary,
  }).catch((error) => {
    logger.error('Failed to write action log entry', {
      error: error instanceof Error ? error.message : String(error),
      toolName,
      decision,
    })
  })
}
