/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useState } from 'react'
import { executePiAction } from '@/lib/pi-actions'
import { PiRailAction } from './PiChrome'
import {
  buildPiPageRepairAction,
  type PiRepairFindingClient,
} from './piPageRepair'

export const PiBrokenPagePanel: FC<{
  siteId: string
  pageId: string
  pageTitle?: string
  entityKey?: string
  issues?: string[]
  fixHint?: string
  renderError?: string
  agentBrief?: string
  findings?: PiRepairFindingClient[]
  contentSummary?: {
    title?: string
    nodeTypes?: string[]
    boardSummaries?: Array<{
      columns: string[]
      cardTitles: string[]
      shape: string
    }>
  }
}> = ({
  siteId,
  pageId,
  pageTitle,
  entityKey,
  issues = [],
  fixHint,
  renderError,
  agentBrief,
  findings = [],
  contentSummary,
}) => {
  const [busy, setBusy] = useState(false)
  const needsAgent = findings.filter((f) => f.severity === 'needs_agent')
  const shown = needsAgent.length
    ? needsAgent.map((f) => f.summary)
    : [...(renderError ? [`UI render error: ${renderError}`] : []), ...issues]

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-5 py-8">
      <div className="border-border border-y py-4">
        <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          Page needs repair
        </div>
        <h2 className="mt-1 font-medium text-foreground text-lg tracking-tight">
          {pageTitle || 'This page'} could not render cleanly
        </h2>
        <p className="mt-2 max-w-prose text-foreground/80 text-sm leading-relaxed">
          The rest of the site still works. The system classified the failure
          and can hand a repair plan to the agent.
        </p>
        {shown.length > 0 ? (
          <ul className="mt-4 space-y-1.5 font-mono text-[11px] text-muted-foreground">
            {shown.slice(0, 8).map((issue) => (
              <li key={issue} className="border-border border-l-2 pl-3">
                {issue}
              </li>
            ))}
          </ul>
        ) : null}
        {agentBrief ? (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground leading-relaxed">
            {agentBrief.slice(0, 1200)}
          </pre>
        ) : fixHint ? (
          <p className="mt-3 max-w-prose font-mono text-[11px] text-muted-foreground leading-relaxed">
            {fixHint}
          </p>
        ) : null}
        <div className="mt-5">
          <PiRailAction
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void executePiAction(
                buildPiPageRepairAction({
                  siteId,
                  pageId,
                  pageTitle,
                  entityKey,
                  issues,
                  fixHint,
                  renderError,
                  agentBrief,
                  findings,
                  contentSummary,
                }),
              ).finally(() => setBusy(false))
            }}
          >
            {busy ? 'Opening agent…' : 'Fix with agent'}
          </PiRailAction>
        </div>
      </div>
    </div>
  )
}
