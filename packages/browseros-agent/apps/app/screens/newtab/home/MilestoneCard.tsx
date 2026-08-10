/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { X } from 'lucide-react'
import type { FC } from 'react'

export const MilestoneCard: FC<{ onDismiss: () => void }> = ({ onDismiss }) => (
  <div className="flex items-center justify-between gap-3 border border-[var(--signal)]/40 bg-[var(--signal)]/5 px-4 py-3 text-sm">
    <span>
      Pane just learned its first skill from watching you work — it'll keep
      getting more useful the more you use it.
    </span>
    <button
      type="button"
      onClick={onDismiss}
      className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      aria-label="Dismiss"
    >
      <X className="h-4 w-4" />
    </button>
  </div>
)
