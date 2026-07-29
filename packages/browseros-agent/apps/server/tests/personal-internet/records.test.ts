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
import { entityRoute } from '../../src/personal-internet/paths'
import { normalizeJobSearchRecord } from '../../src/personal-internet/records'
import { getPulse, readPageDoc } from '../../src/personal-internet/store'
import { buildPersonalInternetToolSet } from '../../src/personal-internet/tools'
import { applyPiMutation } from '../../src/personal-internet/write-path'

describe('pi records', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-records-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('normalizeJobSearchRecord fills entityKey and stage', () => {
    const n = normalizeJobSearchRecord({
      company: 'Acme Corp',
      stage: 'interviewing',
    })
    expect(n.company).toBe('Acme Corp')
    expect(n.stage).toBe('interviewing')
    expect(n.entityKey).toBe('acme-corp')
  })

  it('upsert job-application yields non-empty pulse and board cards', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    expect(site.siteId).toBeTruthy()

    const result = await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: {
        company: 'Acme',
        role: 'SWE',
        stage: 'interviewing',
        nextAction: 'Prep system design',
      },
    })
    expect(result.pulseLine).toContain('interviewing')
    expect(result.pulseLine).not.toContain('Empty')

    const pulse = getPulse(site.siteId!)
    expect(pulse?.counts.interviewing).toBe(1)
    expect(pulse?.topUrgencies[0]?.deepLink).toBe(
      entityRoute(site.siteId!, 'acme'),
    )

    const doc = await readPageDoc(site.pageId!)
    const board = doc?.nodes.find((n) => n.type === 'board')
    expect(board?.type).toBe('board')
    if (board?.type === 'board') {
      expect(board.cards).toHaveLength(1)
      expect(board.cards[0].title).toBe('Acme')
      expect(
        board.columns.find((c) => c.id === 'interviewing')?.cardIds,
      ).toEqual([board.cards[0].id])
      expect(board.cards[0].actions?.[0]).toMatchObject({
        label: 'Details',
        action: {
          kind: 'open-internal',
          route: entityRoute(site.siteId!, 'acme'),
        },
      })
    }

    const chart = doc?.nodes.find((n) => n.type === 'chart')
    expect(chart?.type).toBe('chart')
    if (chart?.type === 'chart') {
      expect(
        chart.data.some((d) => d.label === 'interviewing' && d.value === 1),
      ).toBe(true)
    }
  })

  it('moveBoardCard updates record stage', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const upserted = await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Beta', stage: 'applied' },
    })
    const cardId = `card_${upserted.recordId}`
    await applyPiMutation({
      type: 'patch-page',
      pageId: site.pageId!,
      ops: [{ op: 'moveBoardCard', cardId, toColumnId: 'offer' }],
    })
    const tools = buildPersonalInternetToolSet()
    const listed = await tools.pi_record_list!.execute!(
      { siteId: site.siteId! },
      { toolCallId: 't', messages: [] },
    )
    const body = JSON.parse((listed as { text: string }).text) as {
      records: Array<{ data: { stage: string } }>
    }
    expect(body.records[0].data.stage).toBe('offer')
  })

  it('pi_record_upsert tool roundtrip', async () => {
    setup()
    const tools = buildPersonalInternetToolSet()
    const created = await tools.pi_site_upsert!.execute!(
      { templateId: 'job-search' },
      { toolCallId: 't', messages: [] },
    )
    const siteBody = JSON.parse((created as { text: string }).text) as {
      siteId: string
    }
    const up = await tools.pi_record_upsert!.execute!(
      {
        siteId: siteBody.siteId,
        recordType: 'job-application',
        data: { company: 'Gamma', stage: 'applied' },
      },
      { toolCallId: 't', messages: [] },
    )
    expect((up as { isError?: boolean }).isError).toBeFalsy()
    const list = await tools.pi_record_list!.execute!(
      { siteId: siteBody.siteId },
      { toolCallId: 't', messages: [] },
    )
    const listBody = JSON.parse((list as { text: string }).text) as {
      count: number
    }
    expect(listBody.count).toBe(1)
  })
})
