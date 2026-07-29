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
import { getPulse, readPageDoc } from '../../src/personal-internet/store'
import { applyPiMutation } from '../../src/personal-internet/write-path'

/** Chassis checks for Ship Bar S1–S2 / S5 (server-side). */
describe('pi ship bar integration', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-ship-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('S1–S2: template + ≥5 records → non-empty pulse; board matches stages', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const companies = ['A', 'B', 'C', 'D', 'E']
    const stages = [
      'applied',
      'interviewing',
      'offer',
      'ghosted',
      'rejected',
    ] as const
    for (let i = 0; i < 5; i++) {
      await applyPiMutation({
        type: 'upsert-record',
        siteId: site.siteId!,
        recordType: 'job-application',
        data: {
          company: companies[i],
          stage: stages[i],
          nextAction: i === 1 ? 'Prep' : undefined,
        },
      })
    }
    const pulse = getPulse(site.siteId!)
    expect(pulse?.pulseLine).not.toContain('Empty')
    expect(pulse?.counts.interviewing).toBe(1)
    expect(pulse?.topUrgencies[0]?.deepLink).toBe(
      entityRoute(site.siteId!, 'b'),
    )

    const doc = await readPageDoc(site.pageId!)
    const board = doc?.nodes.find((n) => n.type === 'board')
    expect(board?.type).toBe('board')
    if (board?.type === 'board') {
      expect(board.cards).toHaveLength(5)
      for (const stage of stages) {
        expect(board.columns.find((c) => c.id === stage)?.cardIds.length).toBe(
          1,
        )
      }
    }
  })

  it('S3: synced cards have Details → entity route', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Nova', stage: 'applied' },
    })
    const doc = await readPageDoc(site.pageId!)
    const board = doc?.nodes.find((n) => n.type === 'board')
    expect(board?.type).toBe('board')
    if (board?.type === 'board') {
      const details = board.cards[0].actions?.[0]
      expect(details).toMatchObject({
        label: 'Details',
        action: {
          kind: 'open-internal',
          route: entityRoute(site.siteId!, 'nova'),
        },
      })
    }
  })

  it('S5: moveBoardCard updates record stage', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const up = await applyPiMutation({
      type: 'upsert-record',
      siteId: site.siteId!,
      recordType: 'job-application',
      data: { company: 'Zed', stage: 'applied' },
    })
    await applyPiMutation({
      type: 'patch-page',
      pageId: site.pageId!,
      ops: [
        {
          op: 'moveBoardCard',
          cardId: `card_${up.recordId}`,
          toColumnId: 'interviewing',
        },
      ],
    })
    const pulse = getPulse(site.siteId!)
    expect(pulse?.counts.interviewing).toBe(1)
    expect(pulse?.counts.applied ?? 0).toBe(0)
  })
})
