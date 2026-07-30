/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { insertRunningChatTurn } from '../../src/agent/chat-turns-store'
import { conversationTurnRegistry } from '../../src/agent/conversation-turn-registry'
import { closeDb, getDb, getDbHandle, initializeDb } from '../../src/lib/db'
import { chatSessions } from '../../src/lib/db/schema/chat-sessions'
import {
  acquirePiFocus,
  cancelMaterializeRun,
  getPiFocus,
  releasePiFocus,
  resetPiFocusForTests,
  setPiFocusRun,
} from '../../src/personal-internet/focus'
import { ensureAndMaterialize } from '../../src/personal-internet/materialize'
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { updateRunStatus } from '../../src/scheduler/run-executor'

describe('pi focus', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetPiFocusForTests()
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-focus-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('switching focus cancels other site materialize runs', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Alpha', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Beta', stage: 'applied' },
    })

    const a = await ensureAndMaterialize(site.siteId!, 'alpha', {
      materialize: true,
    })
    expect(a.runId).toBeTruthy()

    const b = await ensureAndMaterialize(site.siteId!, 'beta', {
      materialize: true,
    })
    expect(b.runId).toBeTruthy()
    expect(b.runId).not.toBe(a.runId)

    const aRow = getDbHandle()
      .sqlite.prepare(`SELECT status FROM scheduled_runs WHERE id = ?`)
      .get(a.runId!) as { status: string }
    expect(aRow.status).toBe('cancelled')

    const focus = acquirePiFocus({
      siteId: site.siteId!,
      pageId: b.pageId,
      entityKey: 'beta',
      runId: b.runId,
    })
    expect(focus.pageId).toBe(b.pageId)
  })

  it('ATF-only ensure does not steal focus from an active BTF', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Alpha', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Beta', stage: 'applied' },
    })

    const a = await ensureAndMaterialize(site.siteId!, 'alpha', {
      materialize: true,
    })
    expect(a.runId).toBeTruthy()
    expect(getPiFocus()?.pageId).toBe(a.pageId)

    const cheap = await ensureAndMaterialize(site.siteId!, 'beta', {
      materialize: false,
    })
    expect(cheap.focusAcquired).toBe(false)
    expect(getPiFocus()?.pageId).toBe(a.pageId)

    const aRow = getDbHandle()
      .sqlite.prepare(`SELECT status FROM scheduled_runs WHERE id = ?`)
      .get(a.runId!) as { status: string }
    expect(aRow.status).toBe('pending')
  })

  it('releasePiFocus clears lease without cancelling BTF run', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Alpha', stage: 'applied' },
    })

    const a = await ensureAndMaterialize(site.siteId!, 'alpha', {
      materialize: true,
    })
    expect(a.runId).toBeTruthy()
    expect(getPiFocus()?.runId).toBe(a.runId)

    const released = releasePiFocus({
      siteId: site.siteId!,
      pageId: a.pageId,
    })
    expect(released?.runId).toBe(a.runId)
    expect(getPiFocus()).toBeNull()

    const aRow = getDbHandle()
      .sqlite.prepare(`SELECT status FROM scheduled_runs WHERE id = ?`)
      .get(a.runId!) as { status: string }
    expect(aRow.status).toBe('pending')
  })

  it('cancelMaterializeRun marks chat_turns cancelled (not stuck running)', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Alpha', stage: 'applied' },
    })

    const a = await ensureAndMaterialize(site.siteId!, 'alpha', {
      materialize: true,
    })
    expect(a.runId).toBeTruthy()

    const conversationId = crypto.randomUUID()
    updateRunStatus(a.runId!, {
      status: 'running',
      conversationId,
      startedAt: Date.now(),
    })
    setPiFocusRun(a.runId!, conversationId)

    await getDb().insert(chatSessions).values({
      id: conversationId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const turn = conversationTurnRegistry.register(conversationId, {
      prompt: 'test',
    })
    await insertRunningChatTurn({
      turnId: turn.turnId,
      sessionId: conversationId,
      startedAt: turn.startedAt,
    })

    cancelMaterializeRun(a.runId!, 'pi-focus-switched')

    const runRow = getDbHandle()
      .sqlite.prepare(`SELECT status, error FROM scheduled_runs WHERE id = ?`)
      .get(a.runId!) as { status: string; error: string | null }
    expect(runRow.status).toBe('cancelled')
    expect(runRow.error).toBe('pi-focus-switched')

    // markChatTurnTerminal is async void — give it a tick.
    await new Promise((r) => setTimeout(r, 20))
    const turnRow = getDbHandle()
      .sqlite.prepare(`SELECT status, stop_reason FROM chat_turns WHERE id = ?`)
      .get(turn.turnId) as { status: string; stop_reason: string | null }
    expect(turnRow.status).toBe('cancelled')
    expect(turnRow.stop_reason).toBe('pi-focus-switched')
  })

  it('does not inherit previous page runId when switching without runId', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Alpha', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Beta', stage: 'applied' },
    })

    const a = await ensureAndMaterialize(site.siteId!, 'alpha', {
      materialize: true,
    })
    expect(a.runId).toBeTruthy()

    const b = await ensureAndMaterialize(site.siteId!, 'beta', {
      materialize: false,
    })
    // ensureAndMaterialize acquires focus then may set runId only when materializing.
    // Re-acquire without runId must not keep alpha's cancelled run id.
    const focus = acquirePiFocus({
      siteId: site.siteId!,
      pageId: b.pageId,
      entityKey: 'beta',
    })
    expect(focus.runId).toBeNull()
    expect(focus.pageId).toBe(b.pageId)
  })
})
