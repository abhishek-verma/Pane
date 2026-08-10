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
import { usePiTemplates } from '@/screens/personal-internet/usePiApi'

export const EmptyHomeState: FC = () => {
  const navigate = useNavigate()
  const { data } = usePiTemplates()
  const templates = data?.templates ?? []

  return (
    <section className="border-border border-t">
      <div className="flex items-center justify-between gap-3 py-3">
        <PiSectionLabel>01 Living work</PiSectionLabel>
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
          Empty
        </span>
      </div>
      <p className="pb-1 text-muted-foreground text-sm leading-6">
        Your private web starts empty. Ask Pane to set up living work — a job
        search pipeline, research hub, or whatever you need to keep running.
      </p>
      <p className="pb-3 text-muted-foreground text-xs leading-6">
        The more you use Pane for real work, the more it remembers and starts
        doing without being asked.
      </p>
      <div className="divide-y divide-border border-border border-y">
        {templates.map((t) => (
          <div
            key={t.id}
            className="flex items-center justify-between gap-4 py-3"
          >
            <div className="min-w-0">
              <div className="font-medium text-sm">{t.name}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted-foreground tracking-wide">
                {t.jtbd}
              </div>
            </div>
            <PiRailAction
              onClick={() => {
                const prompt = `Set up my ${t.name} site using the ${t.id} template. Show me the doorway on home.`
                navigate(
                  `/home/chat?q=${encodeURIComponent(prompt)}&mode=agent`,
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
