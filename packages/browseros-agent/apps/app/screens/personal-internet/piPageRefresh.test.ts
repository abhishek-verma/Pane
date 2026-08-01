/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { buildPiPageRefreshAction } from './piPageRefresh'

describe('buildPiPageRefreshAction', () => {
  it('targets entity routes and keeps page ids in metadata', () => {
    const action = buildPiPageRefreshAction({
      siteId: 'site_1',
      pageId: 'page_1',
      entityKey: 'nablon',
      company: 'Nablon',
      pageTitle: 'Nablon',
    })

    expect(action.kind).toBe('agent')
    if (action.kind !== 'agent') throw new Error('expected agent action')
    expect(action.metadata).toMatchObject({
      returnRoute: '/pi/sites/site_1/entities/nablon',
      siteId: 'site_1',
      pageId: 'page_1',
      entityKey: 'nablon',
      intent: 'pi-page-refresh',
    })
    expect(action.query).toContain('pi-page-patch')
    expect(action.query).toContain('Do not rematerialize')
    expect(action.query).toContain('Nablon')
    expect(action.query).toContain('Audit for corruption')
    expect(action.query).toContain('restore ATF first')
    expect(action.query).toContain(
      'Never replaceNodes with only a single BTF section',
    )
  })

  it('targets site page routes when there is no entity key', () => {
    const action = buildPiPageRefreshAction({
      siteId: 'site_1',
      pageId: 'page_board',
      pageTitle: 'Job Search',
    })

    expect(action.kind).toBe('agent')
    if (action.kind !== 'agent') throw new Error('expected agent action')
    expect(action.metadata.returnRoute).toBe(
      '/pi/sites/site_1/pages/page_board',
    )
    expect(action.metadata.entityKey).toBeUndefined()
    expect(action.query).toContain('broken shell')
    expect(action.query).toContain('Audit for corruption')
  })
})
