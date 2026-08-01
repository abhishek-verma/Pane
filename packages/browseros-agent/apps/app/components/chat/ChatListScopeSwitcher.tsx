/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Recent vs Background scope for chat lists. Recent is the default home;
 * background agents stay out of the way until the user switches (or opens one).
 */

import type { FC } from 'react'
import { cn } from '@/lib/utils'

export type ChatListScope = 'recent' | 'background'

export const ChatListScopeSwitcher: FC<{
  scope: ChatListScope
  onScopeChange: (scope: ChatListScope) => void
  backgroundCount?: number
  className?: string
}> = ({ scope, onScopeChange, backgroundCount = 0, className }) => (
  <div
    className={cn(
      'grid grid-cols-2 gap-0.5 rounded-md border border-border bg-muted/40 p-0.5',
      className,
    )}
    role="tablist"
    aria-label="Chat list scope"
  >
    <button
      type="button"
      role="tab"
      aria-selected={scope === 'recent'}
      onClick={() => onScopeChange('recent')}
      className={cn(
        'rounded-[5px] px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide transition-colors',
        scope === 'recent'
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      Recent
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={scope === 'background'}
      onClick={() => onScopeChange('background')}
      className={cn(
        'rounded-[5px] px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide transition-colors',
        scope === 'background'
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      Background
      {backgroundCount > 0 ? (
        <span className="ml-1 tabular-nums opacity-70">{backgroundCount}</span>
      ) : null}
    </button>
  </div>
)
