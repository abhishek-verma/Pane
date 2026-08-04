/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PiTemplateId } from './types'

const P0_TEMPLATES: PiTemplateId[] = [
  'job-search',
  'research-hub',
  'sales-leads',
]

export function isP0Template(
  templateId: string | null | undefined,
): templateId is PiTemplateId {
  return !!templateId && (P0_TEMPLATES as string[]).includes(templateId)
}

/** P0 living sites auto-earn a home doorway; others stay proposed/library-only. */
export function shouldAutoDoorway(
  templateId: string | null | undefined,
): boolean {
  return isP0Template(templateId)
}

export function slugForTemplate(templateId: PiTemplateId): string {
  switch (templateId) {
    case 'job-search':
      return 'job-search'
    case 'research-hub':
      return 'research'
    case 'sales-leads':
      return 'sales-leads'
    case 'reading-list':
      return 'reading-list'
    case 'habit-tracker':
      return 'habit-tracker'
    case 'project-tracker':
      return 'project-tracker'
    case 'blank':
      return 'site'
  }
}

export function defaultNameForTemplate(templateId: PiTemplateId): string {
  switch (templateId) {
    case 'job-search':
      return 'Job Search'
    case 'research-hub':
      return 'Research'
    case 'sales-leads':
      return 'Sales Pipeline'
    case 'reading-list':
      return 'Reading List'
    case 'habit-tracker':
      return 'Habit Tracker'
    case 'project-tracker':
      return 'Project Tracker'
    case 'blank':
      return 'New site'
  }
}
