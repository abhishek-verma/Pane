/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * First-open starters for Personalised Internet sites (prefill chat).
 */

import type { FC } from 'react'
import { useNavigate } from 'react-router'
import {
  PiRailAction,
  PiSectionLabel,
} from '@/screens/personal-internet/PiChrome'

const PI_STARTERS = [
  {
    id: 'job-search',
    title: 'Start a job search pipeline',
    description: 'Living board of roles, stages, and follow-ups',
    prompt:
      'Set up my Job Search site using the job-search template. Create the pipeline board and show me the doorway on home.',
  },
  {
    id: 'research-hub',
    title: 'Start a research hub',
    description: 'Track threads, sources, and open questions',
    prompt:
      'Create a Research Hub site with the research-hub template and open it so I can add my first thread.',
  },
] as const

export const EmptyHomeState: FC = () => {
  const navigate = useNavigate()

  return (
    <section className="border-border border-t">
      <div className="flex items-center justify-between gap-3 py-3">
        <PiSectionLabel>01 Living work</PiSectionLabel>
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
          Empty
        </span>
      </div>
      <p className="pb-3 text-muted-foreground text-sm leading-6">
        Your private web starts empty. Ask Pane to set up living work — a job
        search pipeline, research hub, or whatever you need to keep running.
      </p>
      <div className="divide-y divide-border border-border border-y">
        {PI_STARTERS.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="min-w-0">
              <div className="font-medium text-sm">{t.title}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground tracking-wide">
                {t.description}
              </div>
            </div>
            <PiRailAction
              onClick={() => {
                navigate(
                  `/home/chat?q=${encodeURIComponent(t.prompt)}&mode=agent`,
                )
              }}
            >
              Ask
            </PiRailAction>
          </div>
        ))}
      </div>
    </section>
  )
}
