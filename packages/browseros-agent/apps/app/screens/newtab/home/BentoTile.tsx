/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Bento grid tile for Home's Continue zone. Size communicates priority
 * (pinned/most-recent = lg); a template icon communicates category. No new
 * color tokens — --signal is the one existing accent, reserved for the
 * pinned/updated state.
 */

import type { LucideIcon } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const BentoTile: FC<{
  icon: LucideIcon
  title: string
  subtitle: string
  size?: 'lg' | 'sm'
  pinned?: boolean
  updated?: boolean
  badge?: ReactNode
  onClick: () => void
  actions?: ReactNode
}> = ({
  icon: Icon,
  title,
  subtitle,
  size = 'sm',
  pinned = false,
  updated = false,
  badge,
  onClick,
  actions,
}) => {
  return (
    <div
      className={cn(
        'group relative flex flex-col justify-between border border-border p-3 transition-colors hover:bg-muted/40',
        size === 'lg' ? 'col-span-2 row-span-2 min-h-32' : 'min-h-20',
        pinned && 'border-[var(--signal)]/50',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 flex-col items-start gap-2 text-left"
      >
        <Icon
          className={cn(
            'shrink-0 text-muted-foreground',
            size === 'lg' ? 'h-5 w-5' : 'h-4 w-4',
          )}
        />
        {updated ? (
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] text-[var(--signal)] uppercase tracking-[0.06em]"
            title="Pane updated this while you were away"
          >
            <span className="size-1.5 rounded-full bg-[var(--signal)]" />
            Updated
          </span>
        ) : null}
        <div className="min-w-0">
          <div
            className={cn(
              'truncate font-medium',
              size === 'lg' ? 'text-base' : 'text-sm',
            )}
          >
            {title}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground tracking-wide">
            {subtitle}
          </div>
        </div>
      </button>
      {badge ? <div className="mt-2">{badge}</div> : null}
      {actions ? (
        <div className="mt-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
