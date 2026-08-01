/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { backgroundAgentLabel } from '@/lib/conversations/background-agent-label'

export const BackgroundAgentBanner: FC<{
  source?: string | null
}> = ({ source }) => (
  <div className="mx-4 mb-2 rounded-md border border-[var(--signal)]/30 bg-[var(--signal)]/5 px-3 py-2">
    <div className="font-mono text-[10px] text-[var(--signal)] uppercase tracking-wide">
      {backgroundAgentLabel(source)}
    </div>
    <div className="mt-0.5 text-muted-foreground text-xs leading-5">
      This turn was started by a background agent, not by you in this chat.
    </div>
  </div>
)
