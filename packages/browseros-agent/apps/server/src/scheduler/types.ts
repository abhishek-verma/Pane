/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const DEFAULT_TRIGGER_COOLDOWN_MS = 5 * 60 * 1000

export interface TriggerMatch {
  /** Match graph events whose toolName equals this (optional). */
  toolName?: string
  /** Fire only on the Nth matching occurrence (1-based). */
  occurrenceN?: number
  /** Substring that must appear in payload JSON (optional). */
  payloadContains?: string
}

export interface TriggerRule {
  id: string
  name: string
  enabled: boolean
  match: TriggerMatch
  prompt: string
  jobId?: string | null
  bucketId: string
  cooldownMs: number
  lastFiredAt: number | null
  matchCount: number
  createdAt: number
  updatedAt: number
}

export interface CreateTriggerRuleInput {
  name: string
  match: TriggerMatch
  prompt: string
  bucketId?: string
  jobId?: string
  enabled?: boolean
  cooldownMs?: number
  id?: string
}

export type RunSource =
  | 'trigger'
  | 'digest'
  | 'keepalive'
  | 'manual'
  | 'schedule'
  | 'pi-harvest'

export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'awaiting-approval'

export interface CompletedStep {
  toolCallId: string
  toolName: string
  class: string
  fingerprint: string
}

export interface ScheduledRunRecord {
  id: string
  source: RunSource
  sourceId: string | null
  idempotencyKey: string
  prompt: string
  bucketId: string | null
  status: RunStatus
  completedSteps: CompletedStep[]
  conversationId: string | null
  result: string | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
  createdAt: number
}

export interface StartRunInput {
  source: RunSource
  sourceId?: string
  prompt: string
  bucketId?: string
  idempotencyKey: string
  unattended?: boolean
}

export type RunExecutor = (input: StartRunInput) => Promise<ScheduledRunRecord>
