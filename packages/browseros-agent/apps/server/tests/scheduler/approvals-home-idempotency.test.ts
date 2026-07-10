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
import { seedPromptFilesIfMissing } from '../../src/memory/files'
import {
  clearChannelOutcomes,
  createPendingApproval,
  findPendingByToken,
  handleApprovalInboundText,
  requestChannelApproval,
  resolveByToken,
  signalApprovalResolved,
} from '../../src/scheduler/approvals'
import { runDailyDigest } from '../../src/scheduler/digest'
import {
  appendHomePrefLine,
  loadHomeWidgets,
  parseHomePrefs,
  rankWidgets,
} from '../../src/scheduler/home'
import {
  appendCompletedStep,
  createRunRecord,
  shouldSkipCompletedStep,
  stepFingerprint,
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
    const resolved = resolveByToken(approval!.approveToken)
    expect(resolved?.resolution).toBe('approved')
    signalApprovalResolved(approval!.id, 'approved')

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
})

describe('adaptive home data (M5.7)', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  it('loads digest from file without LLM; day-1 fallback present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-home-'))
    tempDirs.push(dir)
    const memoriesRoot = join(dir, 'memories')
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    await seedPromptFilesIfMissing(memoriesRoot)
    await runDailyDigest({
      memoriesRoot,
      skipBatteryCheck: true,
      skipQuietHours: true,
      force: true,
      notify: async () => {},
    })

    const { widgets } = await loadHomeWidgets({ memoriesRoot })
    expect(widgets.some((w) => w.type === 'daily-digest')).toBe(true)
    expect(widgets.some((w) => w.type === 'recent-sites-fallback')).toBe(true)
    const digest = widgets.find((w) => w.type === 'daily-digest')
    expect(String(digest?.data.content)).toContain('Daily digest')
  })

  it('dismiss preference appends to USER.md shape', () => {
    const next = appendHomePrefLine('# User\n', 'dismiss', 'daily-digest')
    expect(parseHomePrefs(next).dismissed).toContain('daily-digest')
    const ranked = rankWidgets(
      [
        {
          type: 'daily-digest',
          title: 'd',
          why: 'w',
          rank: 1,
          data: {},
        },
        {
          type: 'recent-sites-fallback',
          title: 'r',
          why: 'w',
          rank: 100,
          data: {},
        },
      ],
      parseHomePrefs(next),
    )
    expect(ranked.map((w) => w.type)).toEqual(['recent-sites-fallback'])
  })
})
