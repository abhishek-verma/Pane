/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * First-open starters for Personalised Internet sites (prefill chat).
 */

import { Briefcase, Search } from 'lucide-react'
import type { FC } from 'react'
import { useNavigate } from 'react-router'

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

export const EmptyHomeState: FC = () => {
  const navigate = useNavigate()

  return (
    <div className="space-y-4 rounded-md border border-border/60 border-dashed p-5">
      <p className="text-center text-muted-foreground text-sm">
        Your private web starts empty. Ask Pane to set up living work — a job
        search pipeline, research hub, or whatever you need to keep running.
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
    </div>
  )
}
