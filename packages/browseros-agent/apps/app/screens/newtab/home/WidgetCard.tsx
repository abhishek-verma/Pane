/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * WidgetCard — the primary card component for home widgets.
 */

import {
  BookOpen,
  CalendarClock,
  CheckCircle,
  FileText,
  Folder,
  MoreHorizontal,
  RefreshCw,
} from 'lucide-react'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { HomeWidget } from './AdaptiveHomeWidgets'

const WIDGET_ICONS: Record<string, FC<{ className?: string }>> = {
  'next-meeting': CalendarClock,
  'research-thread': BookOpen,
  'pending-approvals': CheckCircle,
  'one-click-recurring': RefreshCw,
  'daily-digest': FileText,
  'resumed-work': Folder,
}

function getWidgetIcon(type: string): FC<{ className?: string }> {
  if (type in WIDGET_ICONS) return WIDGET_ICONS[type] ?? FileText
  if (type.startsWith('user:tasks')) return CheckCircle
  if (type.startsWith('user:scheduled')) return RefreshCw
  if (type.startsWith('user:capture')) return BookOpen
  if (type.startsWith('user:graph')) return Folder
  if (type.startsWith('user:skills')) return RefreshCw
  return FileText
}

function relativeTime(ts: string | number | null | undefined): string {
  if (!ts) return ''
  const ms = typeof ts === 'number' ? ts : new Date(ts).getTime()
  const diffMs = Date.now() - ms
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.round(diffH / 24)
  if (diffD === 1) return 'yesterday'
  if (diffD < 7) return `${diffD}d ago`
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

interface WidgetMeta {
  timestamp: string
  actionLabel: string
  urgent: boolean
}

function getWidgetMeta(widget: HomeWidget): WidgetMeta {
  switch (widget.type) {
    case 'next-meeting': {
      const status = String(widget.data.status ?? '')
      return {
        timestamp:
          status === 'active'
            ? 'Live'
            : relativeTime(widget.data.updatedAt as number | null),
        actionLabel: status === 'active' ? 'Join' : 'Open transcript',
        urgent: status === 'active',
      }
    }
    case 'research-thread':
      return {
        timestamp: relativeTime(widget.data.updatedAt as number | null),
        actionLabel: 'Resume',
        urgent: false,
      }
    case 'pending-approvals': {
      const count = (widget.data.items as unknown[])?.length ?? 0
      return {
        timestamp: '',
        actionLabel: count > 0 ? 'Review' : 'View tasks',
        urgent: count > 0,
      }
    }
    case 'one-click-recurring':
      return { timestamp: '', actionLabel: 'Run now', urgent: false }
    case 'daily-digest':
      return { timestamp: 'Today', actionLabel: 'Read', urgent: false }
    case 'resumed-work':
      return { timestamp: '', actionLabel: 'Restore', urgent: false }
    default: {
      const actionType =
        (widget.action as { type?: string } | undefined)?.type ?? ''
      const labels: Record<string, string> = {
        'open-route': 'View',
        'chat-prefill': 'Ask',
        'run-skill': 'Run',
        navigate: 'Open',
      }
      return {
        timestamp: '',
        actionLabel: labels[actionType] ?? 'Open',
        urgent: false,
      }
    }
  }
}

const WidgetContent: FC<{ widget: HomeWidget }> = ({ widget }) => {
  if (widget.type === 'daily-digest') {
    const content = String(widget.data.content ?? '')
    return (
      <p className="line-clamp-3 text-muted-foreground text-xs leading-5">
        {content.slice(0, 240)}
      </p>
    )
  }
  if (widget.type === 'pending-approvals') {
    const items = (widget.data.items as Array<Record<string, string>>) ?? []
    if (items.length === 0)
      return (
        <p className="text-muted-foreground text-xs">No pending actions.</p>
      )
    return (
      <div className="space-y-1">
        {items.slice(0, 3).map((item) => (
          <div key={item.id} className="text-sm">
            <span className="font-medium">
              {item.toolName ?? item.title ?? item.id}
            </span>
            {item.preview ? (
              <span className="text-muted-foreground">
                {' '}
                — {item.preview.slice(0, 60)}
              </span>
            ) : null}
          </div>
        ))}
        {items.length > 3 && (
          <p className="text-muted-foreground text-xs">
            +{items.length - 3} more
          </p>
        )}
      </div>
    )
  }
  if (widget.type === 'resumed-work') {
    const pages =
      (widget.data.pages as Array<{ title?: string; uri?: string }>) ?? []
    return (
      <div className="space-y-1">
        {pages.slice(0, 3).map((p, i) => (
          <p key={p.uri ?? String(i)} className="truncate text-sm">
            {p.title ?? p.uri}
          </p>
        ))}
      </div>
    )
  }
  if (widget.type === 'one-click-recurring') {
    const skills =
      (widget.data.skills as Array<{ id: string; name: string }>) ?? []
    return (
      <div className="space-y-1">
        {skills.slice(0, 3).map((s) => (
          <p key={s.id} className="text-sm">
            {s.name}
          </p>
        ))}
      </div>
    )
  }
  if (widget.type === 'next-meeting') {
    const title = String(widget.data.title ?? widget.data.url ?? 'Meeting')
    const status = String(widget.data.status ?? '')
    return (
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">
          {status === 'active' ? 'Recording now' : 'Recent meeting'}
        </p>
      </div>
    )
  }
  if (widget.type === 'research-thread') {
    const topic = String(widget.data.topic ?? 'Research')
    const pageCount = Number(widget.data.pageCount ?? 0)
    return (
      <div>
        <p className="font-medium text-sm">{topic}</p>
        <p className="text-muted-foreground text-xs">
          {pageCount} captured page{pageCount === 1 ? '' : 's'}
        </p>
      </div>
    )
  }
  // User widget — show binding result
  const binding = widget.data.binding as
    | {
        items?: Array<{ label: string; sublabel?: string }>
        primaryLabel?: string
        count?: number
      }
    | undefined
  if (!binding) return null
  const label = binding.primaryLabel ?? binding.items?.[0]?.label ?? ''
  const count = binding.count ?? binding.items?.length ?? 0
  return (
    <div>
      {label && <p className="font-medium text-sm">{label}</p>}
      {count > 0 && !binding.primaryLabel && (
        <p className="text-muted-foreground text-xs">
          {count} item{count === 1 ? '' : 's'}
        </p>
      )}
      {binding.items?.slice(0, 3).map((item, i) => (
        <p key={String(i)} className="truncate text-muted-foreground text-xs">
          {item.label}
        </p>
      ))}
    </div>
  )
}

export interface WidgetCardProps {
  widget: HomeWidget
  onPin?: () => void
  onHide?: () => void
  onDismiss?: () => void
  onAction?: () => void
  showWhyInline?: boolean
}

export const WidgetCard: FC<WidgetCardProps> = ({
  widget,
  onPin,
  onHide,
  onDismiss,
  onAction,
  showWhyInline = false,
}) => {
  const [hovered, setHovered] = useState(false)
  const Icon = getWidgetIcon(widget.type)
  const meta = getWidgetMeta(widget)

  return (
    <article
      className="group relative rounded-[var(--radius)] border border-border/50 bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm leading-snug">
            {widget.title}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {meta.timestamp && (
            <span className="text-muted-foreground text-xs">
              {meta.timestamp}
            </span>
          )}
          <div
            className={`transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onPin && (
                  <DropdownMenuItem onClick={onPin}>
                    {widget.pinned ? 'Unpin' : 'Pin to top'}
                  </DropdownMenuItem>
                )}
                {onHide && (
                  <DropdownMenuItem onClick={onHide}>Hide</DropdownMenuItem>
                )}
                {onDismiss && (
                  <DropdownMenuItem onClick={onDismiss}>
                    Dismiss
                  </DropdownMenuItem>
                )}
                {widget.why && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-muted-foreground text-xs"
                      onSelect={(e) => e.preventDefault()}
                    >
                      {widget.why}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Inline why (first-show) */}
      {showWhyInline && widget.why && (
        <p className="mb-2 text-muted-foreground text-xs italic">
          {widget.why}
        </p>
      )}

      {/* Primary content */}
      <div className="mb-3 min-h-[1.5rem]">
        <WidgetContent widget={widget} />
      </div>

      {/* Primary action */}
      {meta.actionLabel && (
        <div className="flex justify-end">
          <Button
            variant={meta.urgent ? 'default' : 'secondary'}
            size="sm"
            className={`h-7 text-xs ${meta.urgent ? 'bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange)]/90' : ''}`}
            onClick={onAction}
          >
            {meta.actionLabel}
          </Button>
        </div>
      )}
    </article>
  )
}
