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
  /** @deprecated Templates no longer pre-wire hosts; always null. */
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

function readingList(): PiPageDoc {
  return {
    version: 1,
    title: 'Reading List',
    nodes: [
      { type: 'title', text: 'Reading List' },
      {
        type: 'text',
        text: 'Books and articles to read. Move rows across stages as you go.',
      },
      {
        type: 'board',
        columns: [
          { id: 'to-read', title: 'To Read', cardIds: [] },
          { id: 'reading', title: 'Reading', cardIds: [] },
          { id: 'done', title: 'Done', cardIds: [] },
        ],
        cards: [],
      },
    ],
  }
}

function habitTracker(): PiPageDoc {
  return {
    version: 1,
    title: 'Habit Tracker',
    nodes: [
      { type: 'title', text: 'Habit Tracker' },
      {
        type: 'text',
        text: 'Track daily/weekly habits. Ask chat to log a check-in or update streaks.',
      },
      {
        type: 'stack',
        direction: 'row',
        children: [
          { type: 'stat', label: 'Current streak', value: '0' },
          { type: 'stat', label: 'This week', value: '0/7' },
        ],
      },
      {
        type: 'table',
        columns: [
          { id: 'habit', header: 'Habit' },
          { id: 'streak', header: 'Streak' },
          { id: 'last', header: 'Last check-in' },
        ],
        rows: [
          {
            id: 'example-habit',
            cells: {
              habit: 'Example habit',
              streak: '0',
              last: 'Ask chat to log today',
            },
          },
        ],
      },
    ],
  }
}

function projectTracker(): PiPageDoc {
  return {
    version: 1,
    title: 'Project Tracker',
    nodes: [
      { type: 'title', text: 'Project Tracker' },
      {
        type: 'text',
        text: 'Track tasks across a project. Use row actions to move work forward.',
      },
      {
        type: 'board',
        columns: [
          { id: 'backlog', title: 'Backlog', cardIds: [] },
          { id: 'in-progress', title: 'In Progress', cardIds: [] },
          { id: 'review', title: 'Review', cardIds: [] },
          { id: 'done', title: 'Done', cardIds: [] },
        ],
        cards: [],
      },
    ],
  }
}

function blankSite(): PiPageDoc {
  return {
    version: 1,
    title: 'New site',
    nodes: [
      { type: 'title', text: 'New site' },
      {
        type: 'note',
        text: 'Empty site — ask chat to add sections, tables, boards, or visuals as the work takes shape.',
      },
    ],
  }
}

/** Base site policy — no harvest triggers until user-confirmed config. */
export const defaultSitePolicy = (): PiRefreshPolicy => ({
  triggers: [
    { name: 'entity-mutated', kind: 'A' },
    { name: 'new-day', kind: 'D' },
    { name: 'manual-refresh', kind: 'A' },
  ],
  guards: { cooldownMs: 60_000, requireHarvestEnabled: false },
})

export function getSiteTemplate(id: PiTemplateId): SiteTemplate {
  switch (id) {
    case 'job-search':
      return {
        id,
        name: 'Job Search',
        slug: 'job-search',
        jtbd: 'Maintain applications, interviews, and company research',
        harvestHost: null,
        indexDoc: jobSearchBoard(),
        policy: defaultSitePolicy(),
      }
    case 'research-hub':
      return {
        id,
        name: 'Research',
        slug: 'research',
        jtbd: 'Ongoing multi-source research hub',
        harvestHost: null,
        indexDoc: researchHub(),
        policy: defaultSitePolicy(),
      }
    case 'sales-leads':
      return {
        id,
        name: 'Sales Pipeline',
        slug: 'sales-leads',
        jtbd: 'Qualify and advance leads',
        harvestHost: null,
        indexDoc: salesLeads(),
        policy: defaultSitePolicy(),
      }
    case 'reading-list':
      return {
        id,
        name: 'Reading List',
        slug: 'reading-list',
        jtbd: 'Track books and articles to read',
        harvestHost: null,
        indexDoc: readingList(),
        policy: defaultSitePolicy(),
      }
    case 'habit-tracker':
      return {
        id,
        name: 'Habit Tracker',
        slug: 'habit-tracker',
        jtbd: 'Track daily/weekly habits and streaks',
        harvestHost: null,
        indexDoc: habitTracker(),
        policy: defaultSitePolicy(),
      }
    case 'project-tracker':
      return {
        id,
        name: 'Project Tracker',
        slug: 'project-tracker',
        jtbd: 'Track tasks across a project',
        harvestHost: null,
        indexDoc: projectTracker(),
        policy: defaultSitePolicy(),
      }
    case 'blank':
      return {
        id,
        name: 'New site',
        slug: 'site',
        jtbd: 'Freeform site — no starter structure',
        harvestHost: null,
        indexDoc: blankSite(),
        policy: defaultSitePolicy(),
      }
  }
}
