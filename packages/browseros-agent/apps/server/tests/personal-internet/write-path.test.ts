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
import { validatePageDoc } from '../../src/personal-internet/dsl'
import {
  getPulse,
  getSiteBySlug,
  listRecords,
} from '../../src/personal-internet/store'
import { getSiteTemplate } from '../../src/personal-internet/templates'
import {
  applyPiMutation,
  preserveTemp,
} from '../../src/personal-internet/write-path'

describe('pi write-path and templates', () => {
  const dirs: string[] = []
  afterEach(() => {
    closeDb()
    delete process.env.BROWSEROS_DIR
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
    dirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'pi-wp-'))
    dirs.push(dir)
    process.env.BROWSEROS_DIR = dir
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
    return dir
  }

  it('templates produce valid page docs', () => {
    for (const id of ['job-search', 'research-hub', 'sales-leads'] as const) {
      const t = getSiteTemplate(id)
      expect(() => validatePageDoc(t.indexDoc)).not.toThrow()
    }
    const research = getSiteTemplate('research-hub')
    const researchTable = research.indexDoc.nodes.find(
      (n) => n.type === 'table',
    )
    expect(
      researchTable?.type === 'table' && researchTable.rows.length,
    ).toBeGreaterThan(0)
    const sales = getSiteTemplate('sales-leads')
    const salesTable = sales.indexDoc.nodes.find((n) => n.type === 'table')
    expect(
      salesTable?.type === 'table' && salesTable.rows.length,
    ).toBeGreaterThan(0)
    expect(
      getSiteTemplate('job-search').policy.triggers.some(
        (t) => t.name === 'new-day' && t.kind === 'D',
      ),
    ).toBe(true)
  })

  it('upserts job-search site and recomputes pulse', async () => {
    setup()
    const created = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    expect(created.siteId).toBeTruthy()
    expect(created.route).toContain('#/pi/sites/')
    const site = getSiteBySlug('job-search')
    expect(site?.name).toBe('Job Search')
    expect(site?.doorwayEligible).toBe(1)

    const again = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    expect(again.siteId).toBe(created.siteId)

    await applyPiMutation({
      type: 'upsert-record',
      siteId: created.siteId!,
      recordType: 'application',
      data: {
        company: 'Acme',
        stage: 'applied',
        nextAction: 'Follow up Acme',
      },
    })
    const pulse = getPulse(created.siteId!)
    expect(pulse?.counts.applied).toBe(1)
    expect(listRecords(created.siteId!)).toHaveLength(1)
  })

  it('creates temp page and preserves attach', async () => {
    setup()
    const site = await applyPiMutation({
      type: 'upsert-site',
      templateId: 'job-search',
    })
    const temp = await applyPiMutation({
      type: 'create-page',
      mode: 'temp',
      title: 'Acme brief',
      doc: {
        version: 1,
        title: 'Acme brief',
        nodes: [{ type: 'text', text: 'Notes about Acme' }],
      },
    })
    expect(temp.route).toContain('#/pi/temp/')
    const preserved = await preserveTemp({
      tempId: temp.pageId!,
      mode: 'attach',
      siteId: site.siteId!,
    })
    expect(preserved.siteId).toBe(site.siteId)
    expect(preserved.pageId).toBeTruthy()
  })
})
