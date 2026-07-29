/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PiPageDoc, PiRefreshPolicy, PiTemplateId } from './types'

export type SiteTemplate = {
  id: PiTemplateId
  name: string
  slug: string
  jtbd: string
  harvestHost: string | null
  indexDoc: PiPageDoc
  policy: PiRefreshPolicy
}

function jobSearchBoard(): PiPageDoc {
  return {
    version: 1,
    title: 'Job Search',
    nodes: [
      { type: 'title', text: 'Job Search' },
      {
        type: 'text',
        text: 'Track applications by stage. Use row actions to research, prep, or update status.',
      },
      {
        type: 'board',
        columns: [
          { id: 'applied', title: 'Applied', cardIds: [] },
          { id: 'interviewing', title: 'Interviewing', cardIds: [] },
          { id: 'offer', title: 'Offer', cardIds: [] },
          { id: 'ghosted', title: 'Ghosted', cardIds: [] },
          { id: 'rejected', title: 'Rejected', cardIds: [] },
          { id: 'hold', title: 'On hold', cardIds: [] },
        ],
        cards: [],
      },
    ],
  }
}

function researchHub(): PiPageDoc {
  return {
    version: 1,
    title: 'Research',
    nodes: [
      { type: 'title', text: 'Research hub' },
      {
        type: 'text',
        text: 'Topics and sources for ongoing research. Add rows via chat or pi_page_patch.',
      },
      {
        type: 'table',
        columns: [
          { id: 'topic', header: 'Topic' },
          { id: 'status', header: 'Status' },
          { id: 'sources', header: 'Sources' },
          { id: 'next', header: 'Next' },
        ],
        rows: [
          {
            id: 'example-topic',
            cells: {
              topic: 'Example topic',
              status: 'Open',
              sources: 'Replace with real sources',
              next: 'Ask chat to research and update this row',
            },
          },
        ],
      },
      {
        type: 'note',
        text: 'Tip: keep one row per topic; link sources as open-external actions in the Sources cell.',
      },
    ],
  }
}

function salesLeads(): PiPageDoc {
  return {
    version: 1,
    title: 'Sales Pipeline',
    nodes: [
      { type: 'title', text: 'Sales Pipeline' },
      {
        type: 'text',
        text: 'Qualify and advance leads. Prefer records + board sync when you expand beyond this table.',
      },
      {
        type: 'table',
        columns: [
          { id: 'lead', header: 'Lead' },
          { id: 'company', header: 'Company' },
          { id: 'stage', header: 'Stage' },
          { id: 'next', header: 'Next action' },
        ],
        rows: [
          {
            id: 'example-lead',
            cells: {
              lead: 'Example lead',
              company: 'Acme',
              stage: 'Qualify',
              next: 'Ask chat to upsert real leads',
            },
          },
        ],
      },
    ],
  }
}

const defaultSitePolicy = (harvestHost: string | null): PiRefreshPolicy => ({
  triggers: [
    { name: 'entity-mutated', kind: 'A' },
    // Kind D: board/chart sync from records + pulse (not reproject-only).
    { name: 'new-day', kind: 'D' },
    { name: 'manual-refresh', kind: 'A' },
    ...(harvestHost
      ? [{ name: 'host-opened', filter: harvestHost, kind: 'C' as const }]
      : []),
  ],
  guards: { cooldownMs: 60_000, requireHarvestEnabled: !!harvestHost },
})

export function getSiteTemplate(id: PiTemplateId): SiteTemplate {
  switch (id) {
    case 'job-search':
      return {
        id,
        name: 'Job Search',
        slug: 'job-search',
        jtbd: 'Maintain applications, interviews, and company research',
        harvestHost: 'linkedin.com',
        indexDoc: jobSearchBoard(),
        policy: defaultSitePolicy('linkedin.com'),
      }
    case 'research-hub':
      return {
        id,
        name: 'Research',
        slug: 'research',
        jtbd: 'Ongoing multi-source research hub',
        harvestHost: null,
        indexDoc: researchHub(),
        policy: defaultSitePolicy(null),
      }
    case 'sales-leads':
      return {
        id,
        name: 'Sales Pipeline',
        slug: 'sales-leads',
        jtbd: 'Qualify and advance leads',
        harvestHost: null,
        indexDoc: salesLeads(),
        policy: defaultSitePolicy(null),
      }
  }
}
