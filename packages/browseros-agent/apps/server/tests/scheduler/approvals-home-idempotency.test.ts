/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import {
  clearChannelOutcomes,
  createPendingApproval,
  findPendingByToken,
  handleApprovalInboundText,
  requestChannelApproval,
  resolveByToken,
  signalApprovalResolved,
} from '../../src/scheduler/approvals'
import {
  appendCompletedStep,
  claimScheduledRun,
  completeScheduledRun,
  createRunRecord,
  getScheduledRun,
  listScheduledRuns,
  reclaimStaleRunningRuns,
  STALE_RUNNING_MS,
  shouldSkipCompletedStep,
  stepFingerprint,
  updateRunStatus,
} from '../../src/scheduler/run-executor'

describe('approval-over-channel (M5.5)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    clearChannelOutcomes()
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-approval-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('approve executes path; deny cancels; timeout skips', async () => {
    setup()
    const notified: string[] = []

    const pending = requestChannelApproval({
      runId: 'run1',
      toolCallId: 'tc1',
      toolName: 'write_file',
      consequenceClass: 'write-external',
      preview: 'write /tmp/x',
      waitMs: 200,
      notify: async (msg) => {
        notified.push(msg.approveToken)
      },
    })

    // Wait briefly for notify + waiter registration
    await new Promise((r) => setTimeout(r, 20))
    const approval = findPendingByToken(notified[0]!)
    expect(approval).not.toBeNull()

    // Approve via token
    const resolved = resolveByToken(approval?.approveToken)
    expect(resolved?.resolution).toBe('approved')
    signalApprovalResolved(approval?.id, 'approved')

    const result = await pending
    expect(result.resolution).toBe('approved')
    expect(notified).toHaveLength(1)
  })

  it('deny via inbound text', async () => {
    setup()
    const a = createPendingApproval({
      runId: 'r',
      toolCallId: 't',
      toolName: 'bash',
      consequenceClass: 'system',
      preview: 'rm -rf',
    })
    const handled = handleApprovalInboundText(`/deny ${a.denyToken}`)
    expect(handled.handled).toBe(true)
    expect(handled.resolution).toBe('denied')
  })

  it('approve token cannot be used as deny', async () => {
    setup()
    const a = createPendingApproval({
      runId: 'r',
      toolCallId: 't',
      toolName: 'bash',
      consequenceClass: 'system',
      preview: 'x',
    })
    const handled = handleApprovalInboundText(`/deny ${a.approveToken}`)
    expect(handled.handled).toBe(true)
    expect(handled.resolution).toBeUndefined()
    expect(findPendingByToken(a.approveToken)?.status).toBe('pending')
  })

  it('timeout resolves without auto-approve', async () => {
    setup()
    const result = await requestChannelApproval({
      runId: 'run-timeout',
      toolCallId: 'tc',
      toolName: 'write_file',
      consequenceClass: 'write-external',
      preview: 'x',
      waitMs: 30,
      notify: async () => {},
    })
    expect(result.resolution).toBe('timeout')
  })

  it('resolve without active waiter reports resumed=false', () => {
    setup()
    const a = createPendingApproval({
      runId: 'orphan',
      toolCallId: 't',
      toolName: 'run',
      consequenceClass: 'system',
      preview: 'x',
    })
    const resolved = resolveByToken(a.approveToken)
    expect(resolved?.resolution).toBe('approved')
    expect(resolved?.resumed).toBe(false)
  })

  it('resolve with active waiter reports resumed=true', async () => {
    setup()
    const notified: string[] = []
    const pending = requestChannelApproval({
      runId: 'live',
      toolCallId: 't',
      toolName: 'run',
      consequenceClass: 'system',
      preview: 'x',
      waitMs: 5000,
      notify: async (msg) => {
        notified.push(msg.approveToken)
      },
    })
    await new Promise((r) => setTimeout(r, 20))
    const approval = findPendingByToken(notified[0]!)
    const resolved = resolveByToken(approval?.approveToken)
    expect(resolved?.resumed).toBe(true)
    signalApprovalResolved(approval?.id, 'approved')
    expect((await pending).resolution).toBe('approved')
  })
})

describe('idempotency (M5.6)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('fingerprint equality and skip completed consequential steps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-idem-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })

    const fp1 = stepFingerprint(
      'write_file',
      { path: '/tmp/a', content: 'x' },
      'job:slot',
    )
    const fp2 = stepFingerprint(
      'write_file',
      { path: '/tmp/a', content: 'x', __promoted: true },
      'job:slot',
    )
    expect(fp1).toBe(fp2)

    const run = createRunRecord({
      source: 'schedule',
      prompt: 'do stuff',
      idempotencyKey: 'job:slot',
    })
    appendCompletedStep(run.id, {
      toolCallId: 'tc1',
      toolName: 'write_file',
      class: 'write-external',
      fingerprint: fp1,
    })
    const updated = createRunRecord({
      source: 'schedule',
      prompt: 'do stuff',
      idempotencyKey: 'job:slot',
    })
    // Same key returns existing with steps
    expect(updated.id).toBe(run.id)
    expect(
      shouldSkipCompletedStep(
        {
          ...updated,
          completedSteps: [
            {
              toolCallId: 'tc1',
              toolName: 'write_file',
              class: 'write-external',
              fingerprint: fp1,
            },
          ],
        },
        fp1,
        'write-external',
      ),
    ).toBe(true)
  })

  it('list → claim → complete advances pending runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-runs-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })

    const run = createRunRecord({
      source: 'trigger',
      prompt: 'summarize tabs',
      idempotencyKey: 'trigger:r1:e1',
    })
    expect(listScheduledRuns({ status: 'pending' }).map((r) => r.id)).toContain(
      run.id,
    )

    const claimed = claimScheduledRun(run.id)
    expect(claimed?.status).toBe('running')
    expect(claimScheduledRun(run.id)).toBeNull()

    const done = completeScheduledRun(run.id, {
      status: 'completed',
      result: 'ok',
    })
    expect(done?.status).toBe('completed')
    expect(listScheduledRuns({ status: 'pending' }).length).toBe(0)
  })

  it('rejects complete unless running; reclaims stale running to pending', () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-reclaim-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })

    const run = createRunRecord({
      source: 'trigger',
      prompt: 'x',
      idempotencyKey: 'trigger:stale:1',
    })
    expect(
      completeScheduledRun(run.id, { status: 'completed', result: 'nope' }),
    ).toBeNull()

    claimScheduledRun(run.id)
    updateRunStatus(run.id, {
      startedAt: Date.now() - STALE_RUNNING_MS - 1000,
    })
    expect(reclaimStaleRunningRuns()).toBe(1)
    expect(getScheduledRun(run.id)?.status).toBe('pending')
  })
})
