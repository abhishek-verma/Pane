/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { GraphEvent } from '@browseros/context-graph/types'
import { logger } from '../lib/logger'
import {
  listTriggerRules,
  recordTriggerFire,
  recordTriggerMatch,
} from './rules-store'
import { executeRun } from './run-executor'
import type { TriggerMatch, TriggerRule } from './types'

export function eventMatchesRule(
  event: GraphEvent,
  match: TriggerMatch,
): boolean {
  if (match.toolName && event.toolName !== match.toolName) return false
  if (match.payloadContains) {
    if (!event.payloadJson.includes(match.payloadContains)) return false
  }
  return true
}

export function shouldFireAfterMatch(
  rule: TriggerRule,
  matchCountAfter: number,
  now = Date.now(),
): { fire: boolean; reason?: string } {
  if (!rule.enabled) return { fire: false, reason: 'disabled' }

  const occurrenceN = rule.match.occurrenceN
  if (occurrenceN != null && occurrenceN > 0) {
    if (matchCountAfter < occurrenceN) {
      return { fire: false, reason: 'waiting-occurrence' }
    }
    // Fire exactly on the Nth occurrence (not every subsequent).
    if (matchCountAfter !== occurrenceN) {
      return { fire: false, reason: 'occurrence-already-passed' }
    }
    return { fire: true }
  }

  if (rule.lastFiredAt != null && now - rule.lastFiredAt < rule.cooldownMs) {
    return { fire: false, reason: 'cooldown' }
  }

  return { fire: true }
}

export interface OnGraphEventResult {
  matched: string[]
  fired: string[]
  skipped: Array<{ ruleId: string; reason: string }>
}

/**
 * Evaluate enabled trigger rules against a freshly inserted graph event.
 * Best-effort: never throws to the ingest caller.
 */
export async function onGraphEvent(
  event: GraphEvent,
  options?: { skipBatteryCheck?: boolean },
): Promise<OnGraphEventResult> {
  const result: OnGraphEventResult = {
    matched: [],
    fired: [],
    skipped: [],
  }

  try {
    if (!options?.skipBatteryCheck) {
      const { detectOnBattery, getPauseOnBatteryPref } = await import(
        '../context/battery'
      )
      if (getPauseOnBatteryPref()) {
        const onBattery = await detectOnBattery()
        if (onBattery === true) {
          logger.info('trigger fan-out paused on battery')
          return result
        }
      }
    }

    const rules = listTriggerRules().filter((r) => r.enabled)
    for (const rule of rules) {
      if (rule.bucketId !== event.bucketId && rule.bucketId !== '*') {
        continue
      }
      if (!eventMatchesRule(event, rule.match)) continue

      result.matched.push(rule.id)
      const updated = recordTriggerMatch(rule.id)
      const matchCount = updated?.matchCount ?? rule.matchCount + 1
      const decision = shouldFireAfterMatch(updated ?? rule, matchCount)
      if (!decision.fire) {
        result.skipped.push({
          ruleId: rule.id,
          reason: decision.reason ?? 'skipped',
        })
        continue
      }

      const idempotencyKey = `trigger:${rule.id}:${event.id}`
      const record = await executeRun({
        source: 'trigger',
        sourceId: rule.id,
        prompt: rule.prompt,
        bucketId: rule.bucketId === '*' ? event.bucketId : rule.bucketId,
        idempotencyKey,
        unattended: true,
      })
      recordTriggerFire(rule.id)
      result.fired.push(rule.id)
      logger.info('trigger fired', {
        ruleId: rule.id,
        eventId: event.id,
        toolName: event.toolName,
        runId: record.id,
      })
      // Nudge the user / extension so pending runs get drained via /chat.
      void import('../reach/os-push')
        .then(({ createOsPushTransport }) =>
          createOsPushTransport().send({
            type: 'trigger',
            title: 'Pane trigger ready',
            body: `“${rule.name}” matched — open Pane to run it.`,
            deepLink: `browseros://scheduled-runs/${record.id}`,
          }),
        )
        .catch((err) => {
          logger.warn('trigger os-push failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
    }
  } catch (err) {
    logger.warn('onGraphEvent failed', {
      error: err instanceof Error ? err.message : String(err),
      eventId: event.id,
    })
  }

  return result
}
