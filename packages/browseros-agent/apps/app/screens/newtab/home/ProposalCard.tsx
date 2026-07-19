/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * ProposalCard — renders "Pane suggests" for staged/agent-proposed widgets.
 */

import { Sparkles } from 'lucide-react'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { HomeWidget } from './AdaptiveHomeWidgets'

export interface ProposalCardProps {
  widget: HomeWidget
  onAdd: () => void
  onDismiss: () => void
}

export const ProposalCard: FC<ProposalCardProps> = ({
  widget,
  onAdd,
  onDismiss,
}) => {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border border-[var(--accent-orange)]/30 bg-[var(--accent-orange)]/5 p-4">
      <div className="mb-2 flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-orange)]" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[0.65rem] text-[var(--accent-orange)] uppercase tracking-wider">
            Pane suggests
          </p>
          <p className="mt-0.5 font-medium text-sm">{widget.title}</p>
        </div>
      </div>

      {widget.why && (
        <div className="mb-3 pl-6">
          {expanded ? (
            <p className="text-muted-foreground text-xs">{widget.why}</p>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground text-xs underline-offset-2 hover:underline"
            >
              Why Pane is suggesting this
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 pl-6">
        <Button
          size="sm"
          className="h-7 bg-[var(--accent-orange)] text-white text-xs hover:bg-[var(--accent-orange)]/90"
          onClick={onAdd}
        >
          Add to home
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onDismiss}
        >
          Not now
        </Button>
      </div>
    </div>
  )
}
