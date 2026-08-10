/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  Briefcase,
  Globe,
  ListChecks,
  type LucideIcon,
  Repeat,
  Search,
  TrendingUp,
} from 'lucide-react'

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'job-search': Briefcase,
  'research-hub': Search,
  'sales-leads': TrendingUp,
  'reading-list': ListChecks,
  'habit-tracker': Repeat,
  'project-tracker': ListChecks,
}

export function templateIcon(templateId: string): LucideIcon {
  return TEMPLATE_ICONS[templateId] ?? Globe
}
