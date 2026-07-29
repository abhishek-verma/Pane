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
        text: 'Topics and sources for ongoing research.',
      },
      {
        type: 'table',
        columns: [
          { id: 'topic', header: 'Topic' },
          { id: 'status', header: 'Status' },
          { id: 'actions', header: 'Actions' },
        ],
        rows: [],
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
        type: 'table',
        columns: [
          { id: 'lead', header: 'Lead' },
          { id: 'stage', header: 'Stage' },
          { id: 'actions', header: 'Actions' },
        ],
        rows: [],
      },
    ],
  }
}

const defaultSitePolicy = (harvestHost: string | null): PiRefreshPolicy => ({
  triggers: [
    { name: 'entity-mutated', kind: 'A' },
    { name: 'new-day', kind: 'A' },
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
