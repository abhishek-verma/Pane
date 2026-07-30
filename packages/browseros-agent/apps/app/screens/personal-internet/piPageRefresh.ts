/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PiAction } from './types'

export type PiPageRefreshOpts = {
  siteId: string
  pageId: string
  pageTitle?: string
  entityKey?: string
  company?: string
}

/** Build an agent action that refreshes a PI page from latest live info. */
export function buildPiPageRefreshAction(opts: PiPageRefreshOpts): PiAction {
  const subject =
    opts.company || opts.pageTitle || opts.entityKey || 'this page'
  const returnRoute = opts.entityKey
    ? `/pi/sites/${opts.siteId}/entities/${encodeURIComponent(opts.entityKey)}`
    : `/pi/sites/${opts.siteId}/pages/${opts.pageId}`

  const entityIntegrity = opts.entityKey
    ? [
        'For this company entity page, ATF must include title plus stage, role, next action, and notes (or clear equivalents).',
        'If ATF is missing or was wiped by a prior replaceNodes that only wrote a BTF section, restore ATF first, then append BTF sections.',
        `Entity key: ${opts.entityKey}.`,
      ]
    : [
        'For this site page, the title and primary board/table body must still be present and usable.',
        'If a prior patch emptied the page, dropped columns/cards wrongly, or left a broken shell, restore structure before refreshing data.',
      ]

  const query = [
    `Refresh and repair the Personal Internet page for ${subject}.`,
    `Read the current page first via pi_read(pageId=${opts.pageId}) — it returns doc, or raw+issues+fixHint when corrupt.`,
    'Audit for corruption from earlier agent edits: missing or wiped ATF/hero, empty body, deleted sections that should exist, broken boards/tables, orphan placeholders, or a page that only has BTF sections with no ATF.',
    ...entityIntegrity,
    'Fix integrity problems with the smallest safe pi-page-patch ops (prefer appendNodes / setTitle / targeted upserts). Never replaceNodes with only a single BTF section — that deletes ATF.',
    'Then update the page with the latest information from the live web, careers pages, and LinkedIn as appropriate.',
    'Use pi-page-patch (and pi-record-upsert when the page is backed by records). Keep sound structure; refresh stale content and restore missing useful sections.',
    'Do not recreate the page from scratch. Do not rematerialize or call ensure with force.',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    kind: 'agent',
    query,
    metadata: {
      returnRoute,
      siteId: opts.siteId,
      pageId: opts.pageId,
      intent: 'pi-page-refresh',
      ...(opts.entityKey ? { entityKey: opts.entityKey } : {}),
      ...(opts.company ? { company: opts.company } : {}),
      ...(opts.pageTitle ? { pageTitle: opts.pageTitle } : {}),
    },
  }
}
