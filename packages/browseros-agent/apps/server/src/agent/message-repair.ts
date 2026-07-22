/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Single entry point for making a transcript safe to feed back into
 * `createAgentUIStream` / `validateUIMessages`. Covers failure modes that
 * `tool-approval-resolve.ts` does not: legacy AI SDK tool states left over
 * from older persisted sessions, and tool calls that never reached a
 * terminal state because the process aborted or crashed mid-flight.
 */

import type { UIMessage } from 'ai'
import { sanitizeMessagesForToolset } from './message-validation'
import {
  repairInvalidToolApprovalParts,
  settleUnresolvedToolApprovals,
} from './tool-approval-resolve'

type ToolPartLike = {
  type?: string
  state?: string
  toolCallId?: string
  errorText?: string
  output?: unknown
}

function isToolPart(part: unknown): part is ToolPartLike {
  if (!part || typeof part !== 'object') return false
  const type = (part as ToolPartLike).type
  return (
    typeof type === 'string' &&
    (type === 'dynamic-tool' || type.startsWith('tool-'))
  )
}

/**
 * Rewrite deprecated AI SDK tool-part states (`result`/`call`/`partial-call`,
 * from the pre-v5 `toolInvocation` shape) into the current state machine so
 * `validateUIMessages` does not reject old persisted sessions.
 */
export function migrateLegacyToolStates(messages: UIMessage[]): number {
  let migrated = 0
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts) {
      if (!isToolPart(part)) continue
      if (part.state === 'result') {
        part.state = 'output-available'
        migrated++
      } else if (part.state === 'call') {
        part.state = 'input-available'
        migrated++
      } else if (part.state === 'partial-call') {
        part.state = 'input-streaming'
        migrated++
      }
    }
  }
  return migrated
}

/**
 * Settle tool parts left mid-flight (`input-streaming` / `input-available`
 * with no result) into a terminal `output-error` state.
 *
 * These are left behind when the server process aborts or crashes between
 * emitting a tool call and receiving its result. `convertToModelMessages`
 * turns an unresolved `input-available` part into a dangling `tool-call`
 * with no matching `tool-result`, which throws `MissingToolResultsError` on
 * the very next turn — the transcript is otherwise permanently stuck.
 */
export function settleIncompleteToolParts(
  messages: UIMessage[],
  reason = 'Interrupted before the tool finished',
): number {
  let settled = 0
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue
    for (const part of msg.parts) {
      if (!isToolPart(part) || !part.toolCallId) continue
      if (
        part.state !== 'input-available' &&
        part.state !== 'input-streaming'
      ) {
        continue
      }
      part.state = 'output-error'
      part.errorText = reason
      settled++
    }
  }
  return settled
}

export type PrepareMessagesOptions = {
  /** Strip tool parts whose tool name is not in the current toolset. */
  toolNames?: Set<string>
  /** Auto-deny `approval-requested` / orphaned `approval-responded` parts. */
  settleApprovals?: boolean
  /** Settle `input-available` / `input-streaming` parts left mid-flight. */
  settleIncomplete?: boolean
  approvalReason?: string
  incompleteReason?: string
}

export type PrepareMessagesSummary = {
  sanitizedCount: number
  migrated: number
  repairedApprovals: number
  settledApprovals: number
  settledIncomplete: number
}

function hasChanges(summary: PrepareMessagesSummary): boolean {
  return (
    summary.sanitizedCount > 0 ||
    summary.migrated > 0 ||
    summary.repairedApprovals > 0 ||
    summary.settledApprovals > 0 ||
    summary.settledIncomplete > 0
  )
}

export type PrepareMessagesResult = PrepareMessagesSummary & {
  changed: boolean
}

/**
 * Single chokepoint for making a persisted/in-memory transcript safe before
 * every agent turn: hydrate, approval resume, and new user message.
 *
 * Mutates `messages` in place (matches `stripUIImageOutputs` convention) and
 * additionally returns a new array reference when the toolset sanitize step
 * removes messages entirely — callers must reassign `session.agent.messages`
 * to the returned array rather than relying on identity.
 */
export function prepareMessagesForAgentTurn(
  messages: UIMessage[],
  options: PrepareMessagesOptions = {},
): { messages: UIMessage[] } & PrepareMessagesResult {
  let working = messages
  let sanitizedCount = 0
  if (options.toolNames) {
    const before = working.length
    const next = sanitizeMessagesForToolset(working, options.toolNames)
    sanitizedCount = before - next.length
    working = next
  }

  const migrated = migrateLegacyToolStates(working)
  const repairedApprovals = repairInvalidToolApprovalParts(working)
  const settledApprovals = options.settleApprovals
    ? settleUnresolvedToolApprovals(
        working,
        options.approvalReason ?? 'Superseded by a new user message',
      )
    : 0
  const settledIncomplete = options.settleIncomplete
    ? settleIncompleteToolParts(
        working,
        options.incompleteReason ?? 'Interrupted before the tool finished',
      )
    : 0

  const summary: PrepareMessagesSummary = {
    sanitizedCount,
    migrated,
    repairedApprovals,
    settledApprovals,
    settledIncomplete,
  }

  return { messages: working, ...summary, changed: hasChanges(summary) }
}
