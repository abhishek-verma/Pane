/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GraphEvent } from '@browseros/context-graph/types'
import { closeDb, initializeDb } from '../../src/lib/db'
import {
  eventMatchesRule,
  onGraphEvent,
  shouldFireAfterMatch,
} from '../../src/scheduler/engine'
import {
  createTriggerRule,
  listTriggerRules,
} from '../../src/scheduler/rules-store'
import {
  findRunByIdempotencyKey,
  setRunExecutor,
} from '../../src/scheduler/run-executor'
import type {
  ScheduledRunRecord,
  StartRunInput,
} from '../../src/scheduler/types'

describe('trigger engine (M5.1)', () => {
  const tempDirs: string[] = []
  const started: StartRunInput[] = []

  afterEach(() => {
    setRunExecutor(null)
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
    started.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-trigger-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    setRunExecutor(async (input) => {
      started.push(input)
      const record: ScheduledRunRecord = {
        id: `run_test_${started.length}`,
        source: input.source,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey,
        prompt: input.prompt,
        bucketId: input.bucketId ?? null,
        status: 'pending',
        completedSteps: [],
        conversationId: null,
        result: null,
        error: null,
        startedAt: null,
        completedAt: null,
        createdAt: Date.now(),
      }
      return record
    })
    return dir
  }

  function makeEvent(partial: Partial<GraphEvent> = {}): GraphEvent {
    return {
      id: partial.id ?? `evt_${crypto.randomUUID().slice(0, 8)}`,
      bucketId: partial.bucketId ?? 'default',
      runId: partial.runId ?? null,
      toolName: partial.toolName ?? 'navigate',
      nodeId: partial.nodeId ?? null,
      payloadJson:
        partial.payloadJson ?? '{"args":{"url":"https://example.com"}}',
      createdAt: partial.createdAt ?? Date.now(),
    }
  }

  it('eventMatchesRule matches toolName and payload', () => {
    const event = makeEvent({
      toolName: 'navigate',
      payloadJson: '{"args":{"url":"https://staging.example.com"}}',
    })
    expect(eventMatchesRule(event, { toolName: 'navigate' })).toBe(true)
    expect(eventMatchesRule(event, { toolName: 'open' })).toBe(false)
    expect(
      eventMatchesRule(event, {
        toolName: 'navigate',
        payloadContains: 'staging',
      }),
    ).toBe(true)
    expect(
      eventMatchesRule(event, {
        toolName: 'navigate',
        payloadContains: 'production',
      }),
    ).toBe(false)
  })

  it('cooldown suppresses duplicate fires', () => {
    const rule = {
      id: 'r1',
      name: 'test',
      enabled: true,
      match: { toolName: 'navigate' },
      prompt: 'do thing',
      jobId: null,
      bucketId: 'default',
      cooldownMs: 300_000,
      lastFiredAt: Date.now() - 60_000,
      matchCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    expect(shouldFireAfterMatch(rule, 2).fire).toBe(false)
    expect(shouldFireAfterMatch(rule, 2).reason).toBe('cooldown')
    expect(
      shouldFireAfterMatch({ ...rule, lastFiredAt: Date.now() - 400_000 }, 2)
        .fire,
    ).toBe(true)
  })

  it('occurrenceN fires only on the Nth match', () => {
    const rule = {
      id: 'r1',
      name: 'nth',
      enabled: true,
      match: { toolName: 'navigate', occurrenceN: 3 },
      prompt: 'on third',
      jobId: null,
      bucketId: 'default',
      cooldownMs: 0,
      lastFiredAt: null,
      matchCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    expect(shouldFireAfterMatch(rule, 1).fire).toBe(false)
    expect(shouldFireAfterMatch(rule, 2).fire).toBe(false)
    expect(shouldFireAfterMatch(rule, 3).fire).toBe(true)
    expect(shouldFireAfterMatch(rule, 4).fire).toBe(false)
  })

  it('matching graph event starts a run with expected prompt', async () => {
    setup()
    createTriggerRule({
      name: 'on navigate',
      match: { toolName: 'navigate' },
      prompt: 'Summarize the page I just opened',
      bucketId: 'default',
      cooldownMs: 1,
    })

    const event = makeEvent({ toolName: 'navigate' })
    const result = await onGraphEvent(event, { skipBatteryCheck: true })

    expect(result.matched).toHaveLength(1)
    expect(result.fired).toHaveLength(1)
    expect(started).toHaveLength(1)
    expect(started[0]?.prompt).toBe('Summarize the page I just opened')
    expect(started[0]?.source).toBe('trigger')
    expect(started[0]?.unattended).toBe(true)
  })

  it('non-matching event does not start a run', async () => {
    setup()
    createTriggerRule({
      name: 'on open only',
      match: { toolName: 'open' },
      prompt: 'opened',
      bucketId: 'default',
    })

    const result = await onGraphEvent(makeEvent({ toolName: 'navigate' }), {
      skipBatteryCheck: true,
    })
    expect(result.matched).toHaveLength(0)
    expect(result.fired).toHaveLength(0)
    expect(started).toHaveLength(0)
  })

  it('cooldown suppresses second fire for same rule', async () => {
    setup()
    createTriggerRule({
      name: 'cooldown rule',
      match: { toolName: 'navigate' },
      prompt: 'once',
      bucketId: 'default',
      cooldownMs: 600_000,
    })

    const first = await onGraphEvent(makeEvent({ toolName: 'navigate' }), {
      skipBatteryCheck: true,
    })
    expect(first.fired).toHaveLength(1)

    const second = await onGraphEvent(makeEvent({ toolName: 'navigate' }), {
      skipBatteryCheck: true,
    })
    expect(second.matched).toHaveLength(1)
    expect(second.fired).toHaveLength(0)
    expect(second.skipped[0]?.reason).toBe('cooldown')
    expect(started).toHaveLength(1)
  })

  it('persists run record via default executor', async () => {
    setup()
    setRunExecutor(null) // use default
    createTriggerRule({
      name: 'persist',
      match: { toolName: 'snapshot' },
      prompt: 'snap',
      bucketId: 'default',
      cooldownMs: 1,
    })
    const event = makeEvent({ toolName: 'snapshot', id: 'evt_persist_1' })
    await onGraphEvent(event, { skipBatteryCheck: true })
    const run = findRunByIdempotencyKey(
      `trigger:${listTriggerRules()[0]!.id}:evt_persist_1`,
    )
    expect(run).not.toBeNull()
    expect(run?.prompt).toBe('snap')
    expect(run?.status).toBe('pending')
  })
})
