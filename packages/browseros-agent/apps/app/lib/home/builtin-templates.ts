/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Client-side mirror of server BUILTIN_TEMPLATES.
 * Intentionally avoids importing server code into the client bundle.
 */

export interface ClientBuiltinTemplate {
  id: string
  title: string
  description: string
  source: {
    type: 'tasks' | 'scheduled' | 'capture' | 'graph' | 'skills' | 'template'
    query?: string
    templateId?: string
  }
  action: {
    type: 'navigate' | 'chat-prefill' | 'run-skill' | 'open-route'
    target: string
  }
  refreshMinutes: number
  whyText: string
  icpTags: string[]
}

export const BUILTIN_TEMPLATES: ClientBuiltinTemplate[] = [
  {
    id: 'open-tasks',
    title: 'My open tasks',
    description: 'Pending tasks from your task inbox.',
    source: { type: 'tasks', query: 'status:pending' },
    action: { type: 'open-route', target: '#/tasks' },
    refreshMinutes: 5,
    whyText: 'Shows pending tasks from your task inbox.',
    icpTags: ['developer', 'chief-of-staff', 'researcher'],
  },
  {
    id: 'pending-approvals',
    title: 'Pending approvals',
    description: 'Actions waiting for your approve or deny.',
    source: { type: 'tasks', query: 'type:approval' },
    action: { type: 'open-route', target: '#/tasks' },
    refreshMinutes: 1,
    whyText: 'Shows scheduled runs that need your approval.',
    icpTags: ['developer', 'chief-of-staff'],
  },
  {
    id: 'next-scheduled-run',
    title: 'Scheduled tasks',
    description: 'Next upcoming scheduled run.',
    source: { type: 'scheduled' },
    action: { type: 'open-route', target: '#/scheduled' },
    refreshMinutes: 5,
    whyText: 'Shows your next scheduled task run.',
    icpTags: ['developer', 'chief-of-staff'],
  },
  {
    id: 'active-research-thread',
    title: 'Active research',
    description: 'Your most recently active research thread.',
    source: { type: 'capture' },
    action: { type: 'open-route', target: '#/capture' },
    refreshMinutes: 5,
    whyText: 'Shows the research thread you were last working on.',
    icpTags: ['researcher', 'developer'],
  },
  {
    id: 'daily-digest',
    title: 'Daily digest',
    description: "This morning's digest of your activity.",
    source: { type: 'template', templateId: 'daily-digest' },
    action: { type: 'open-route', target: '#/home' },
    refreshMinutes: 60,
    whyText: 'Pre-computed morning summary from your graph and tasks.',
    icpTags: ['chief-of-staff', 'researcher', 'developer'],
  },
]
