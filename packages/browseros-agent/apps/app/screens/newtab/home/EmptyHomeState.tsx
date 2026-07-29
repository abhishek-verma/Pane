/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * EmptyHomeState — shown when no widgets are active.
 * Provides starter template tiles to populate the home quickly,
 * plus Personalised Internet starters that prefill chat.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  Briefcase,
  CheckCircle,
  FileText,
  Search,
} from 'lucide-react'
import type { FC } from 'react'
import { useNavigate } from 'react-router'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { BUILTIN_TEMPLATES } from '@/lib/home/builtin-templates'

const STARTER_IDS = ['daily-digest', 'open-tasks', 'active-research-thread']

const ICONS: Record<string, FC<{ className?: string }>> = {
  'daily-digest': FileText,
  'open-tasks': CheckCircle,
  'active-research-thread': BookOpen,
}

const PI_STARTERS = [
  {
    id: 'job-search',
    title: 'Start a job search pipeline',
    description: 'Living board of roles, stages, and follow-ups',
    Icon: Briefcase,
    prompt:
      'Set up my Job Search site using the job-search template. Create the pipeline board and show me the doorway on home.',
  },
  {
    id: 'research-hub',
    title: 'Start a research hub',
    description: 'Track threads, sources, and open questions',
    Icon: Search,
    prompt:
      'Create a Research Hub site with the research-hub template and open it so I can add my first thread.',
  },
] as const

const HOME_KEY = ['scheduler', 'home'] as const

export const EmptyHomeState: FC = () => {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const addMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId)
      if (!template) return
      const base = await getAgentServerUrl()
      const res = await agentFetch(`${base}/scheduler/home/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: template.title,
          source: template.source,
          action: template.action,
          refreshMinutes: template.refreshMinutes,
          createdBy: 'user',
          whyText: template.whyText,
          status: 'active',
        }),
      })
      if (!res.ok) throw new Error('Failed to add widget')
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: HOME_KEY }),
  })

  const starters = BUILTIN_TEMPLATES.filter((t) => STARTER_IDS.includes(t.id))

  return (
    <div className="space-y-4 rounded-md border border-border/60 border-dashed p-5">
      <p className="text-center text-muted-foreground text-sm">
        As you work, Pane will surface your meetings, open threads, and
        scheduled tasks here.
      </p>
      <div className="space-y-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Living work
        </p>
        {PI_STARTERS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              navigate(
                `/home/chat?q=${encodeURIComponent(t.prompt)}&mode=agent`,
              )
            }}
            className="flex w-full items-center gap-3 rounded-md border border-border/50 bg-card p-3 text-left transition-colors hover:border-[var(--accent-orange)]/40 hover:bg-[var(--accent-orange)]/5"
          >
            <t.Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">{t.title}</p>
              <p className="text-muted-foreground text-xs">{t.description}</p>
            </div>
            <span className="ml-auto text-muted-foreground text-xs">Ask</span>
          </button>
        ))}
      </div>
      <div className="space-y-2">
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
          Quick start
        </p>
        {starters.map((t) => {
          const Icon = ICONS[t.id] ?? FileText
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => addMutation.mutate(t.id)}
              disabled={addMutation.isPending}
              className="flex w-full items-center gap-3 rounded-md border border-border/50 bg-card p-3 text-left transition-colors hover:border-[var(--accent-orange)]/40 hover:bg-[var(--accent-orange)]/5 disabled:opacity-50"
            >
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">{t.title}</p>
                <p className="text-muted-foreground text-xs">{t.description}</p>
              </div>
              <span className="ml-auto text-muted-foreground text-xs">
                + Add
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
