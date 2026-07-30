/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithGateContext } from '../../src/agent/trust/gate'
import { closeDb, initializeDb } from '../../src/lib/db'
import { resetPiFocusForTests } from '../../src/personal-internet/focus'
import { ensureAndMaterialize } from '../../src/personal-internet/materialize'
import { buildPersonalInternetToolSet } from '../../src/personal-internet/tools'
import { applyPiMutation } from '../../src/personal-internet/write-path'
import { claimScheduledRun } from '../../src/scheduler/run-executor'

async function callTool(
  tool: { execute?: (...args: unknown[]) => Promise<unknown> },
  args: Record<string, unknown>,
) {
  const result = await tool.execute!(args, { toolCallId: 't', messages: [] })
  return result as { text: string; isError?: boolean }
}

describe('pi materialize tool guards', () => {
  const dirs: string[] = []
  afterEach(() => {
    resetPiFocusForTests()
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-guard-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('blocks pi_page_create during focused materialize run', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'GuardCo', stage: 'applied' },
    })
    const ensured = await ensureAndMaterialize(site.siteId!, 'guardco', {
      materialize: true,
    })
    claimScheduledRun(ensured.runId!)

    const tools = buildPersonalInternetToolSet()
    const result = await callTool(tools.pi_page_create, {
      mode: 'durable',
      siteId: site.siteId!,
      title: 'Other',
      doc: { version: 1, title: 'Other', nodes: [] },
    })
    expect(result.text.toLowerCase()).toContain('pi-materialize')
    expect(result.text.toLowerCase()).toContain('may not')
  })

  it('blocks pi_entity_ensure and wrong-page patch during materialize', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'GuardCo', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'OtherCo', stage: 'applied' },
    })
    const ensured = await ensureAndMaterialize(site.siteId!, 'guardco', {
      materialize: true,
    })
    claimScheduledRun(ensured.runId!)

    const tools = buildPersonalInternetToolSet()
    const ensureBlocked = await callTool(tools.pi_entity_ensure, {
      siteId: site.siteId!,
      entityKey: 'otherco',
      materialize: true,
    })
    expect(ensureBlocked.text.toLowerCase()).toContain('may not')

    const other = await ensureAndMaterialize(site.siteId!, 'otherco', {
      materialize: false,
    })
    // Re-focus materialize target (otherco ensure stole focus).
    const again = await ensureAndMaterialize(site.siteId!, 'guardco', {
      materialize: true,
    })
    claimScheduledRun(again.runId!)

    const patchBlocked = await callTool(tools.pi_page_patch, {
      pageId: other.pageId,
      ops: [{ op: 'setTitle', title: 'Nope' }],
    })
    expect(patchBlocked.text.toLowerCase()).toContain('may only patch')
  })

  it('guards via scheduledRunId even when process focus is cleared', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'AlsCo', stage: 'applied' },
    })
    const ensured = await ensureAndMaterialize(site.siteId!, 'alsco', {
      materialize: true,
    })
    claimScheduledRun(ensured.runId!)
    resetPiFocusForTests()

    const tools = buildPersonalInternetToolSet()
    const result = await runWithGateContext(
      {
        pins: {},
        runConsequentialCount: { count: 0 },
        isNewUser: false,
        surface: 'loop',
        scheduledRunId: ensured.runId!,
        conversationId: '00000000-0000-4000-8000-000000000001',
      },
      () =>
        callTool(tools.pi_page_create, {
          mode: 'temp',
          title: 'Nope',
          doc: { version: 1, title: 'Nope', nodes: [] },
        }),
    )
    expect(result.text.toLowerCase()).toContain('may not')
  })
})
