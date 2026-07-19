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
import {
  ActionGridTemplate,
  type SkillItem,
} from './templates/ActionGridTemplate'
import {
  ApprovalGateTemplate,
  type ApprovalItem,
} from './templates/ApprovalGateTemplate'
import { BriefingTemplate } from './templates/BriefingTemplate'
import { LiveStatusTemplate } from './templates/LiveStatusTemplate'
import { MetricTemplate } from './templates/MetricTemplate'
import { type PageItem, TimelineTemplate } from './templates/TimelineTemplate'

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
      const items = Array.isArray(widget.data.items)
        ? (widget.data.items as ApprovalItem[])
        : []
      const hasTokens = items.some((item) => item.approveToken)
      return {
        timestamp: '',
        actionLabel: hasTokens ? '' : 'View tasks',
        urgent: !hasTokens && items.length > 0,
      }
    }
    case 'one-click-recurring':
      return { timestamp: '', actionLabel: 'Run now', urgent: false }
    case 'daily-digest':
      return { timestamp: 'Today', actionLabel: '', urgent: false }
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

function cleanDigestContent(content: string): string {
  const lines = content.split('\n')
  const sections: Array<{ title: string; items: string[] }> = []
  let currentSection: { title: string; items: string[] } | null = null
  const headerLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip main title and metadata
    if (
      trimmed.startsWith('# ') &&
      trimmed.toLowerCase().includes('daily digest')
    ) {
      continue
    }
    if (
      trimmed.startsWith('_Assembled') ||
      (trimmed.startsWith('_') &&
        trimmed.endsWith('_') &&
        trimmed.includes('Assembled'))
    ) {
      continue
    }

    // Convert section headers "## Section" to bold uppercase text "SECTION"
    if (trimmed.startsWith('## ')) {
      const secName = trimmed.replace(/^##\s+/, '').toUpperCase()
      currentSection = { title: `**${secName}**`, items: [] }
      sections.push(currentSection)
      continue
    }

    // Replace checkboxes - [inbox] with bullets
    if (trimmed.startsWith('- [') || trimmed.startsWith('- ')) {
      const bullet = trimmed
        .replace(/^-\s+\[[^\]]+\]\s*/, '• ') // Remove status badge e.g. [inbox]
        .replace(/^-\s+/, '• ')
      if (currentSection) {
        currentSection.items.push(bullet)
      } else {
        headerLines.push(bullet)
      }
      continue
    }

    // Keep other non-empty lines but strip markdown bold/italic/code marks
    if (trimmed.length > 0) {
      const cleaned = trimmed.replace(/[*_`]/g, '')
      if (currentSection) {
        currentSection.items.push(cleaned)
      } else {
        headerLines.push(cleaned)
      }
    }
  }

  const outLines: string[] = [...headerLines]
  for (const sec of sections) {
    const activeItems = sec.items.filter((item) => {
      const lower = item.toLowerCase()
      return !lower.includes('none') && lower.trim().length > 0
    })
    if (activeItems.length > 0) {
      if (outLines.length > 0) {
        outLines.push('')
      }
      outLines.push(sec.title)
      outLines.push(...activeItems)
    }
  }

  if (outLines.length === 0) {
    return 'Your daily digest is quiet. No pending approvals, live meetings, or active inbox tasks.'
  }

  return outLines.join('\n').trim()
}

function _getDomain(uri?: string): string {
  if (!uri) return ''
  try {
    const url = new URL(uri)
    return url.hostname.replace('www.', '')
  } catch {
    return ''
  }
}

const WidgetContent: FC<{ widget: HomeWidget }> = ({ widget }) => {
  if (widget.type === 'daily-digest') {
    const content = cleanDigestContent(String(widget.data.content ?? ''))
    return <BriefingTemplate content={content} />
  }
  if (widget.type === 'pending-approvals') {
    const items = Array.isArray(widget.data.items)
      ? (widget.data.items as ApprovalItem[])
      : []
    return <ApprovalGateTemplate items={items} />
  }
  if (widget.type === 'resumed-work') {
    const pages = Array.isArray(widget.data.pages)
      ? (widget.data.pages as PageItem[])
      : []
    return <TimelineTemplate pages={pages} />
  }
  if (widget.type === 'one-click-recurring') {
    const skills = Array.isArray(widget.data.skills)
      ? (widget.data.skills as SkillItem[])
      : []
    return <ActionGridTemplate skills={skills} />
  }
  if (widget.type === 'next-meeting') {
    const status = String(widget.data.status ?? '')
    const url = String(widget.data.url ?? '')
    const startedAt = widget.data.startedAt as number | undefined
    if (status === 'active') {
      return (
        <LiveStatusTemplate status={status} startedAt={startedAt} url={url} />
      )
    }
    return (
      <div className="space-y-1.5 rounded-md border border-border/40 bg-muted/20 p-3">
        <p className="font-semibold text-foreground text-xs">
          {String(widget.data.title ?? 'Recent Meeting')}
        </p>
        <p className="text-muted-foreground text-xs leading-5">
          Meeting ended. Transcription and notes are saved.
        </p>
      </div>
    )
  }
  if (widget.type === 'research-thread') {
    const topic = String(widget.data.topic ?? 'Research')
    const pageCount = Number(widget.data.pageCount ?? 0)
    return (
      <div>
        <p className="font-semibold text-foreground text-sm leading-snug">
          {topic}
        </p>
        <p className="text-muted-foreground text-xs">
          {pageCount} captured page{pageCount === 1 ? '' : 's'}
        </p>
      </div>
    )
  }

  // User widget — show binding result mapped to MetricTemplate
  const binding = widget.data.binding as
    | {
        items?: Array<{
          label: string
          sublabel?: string
          meta?: string
          id?: string
        }>
        primaryLabel?: string
        count?: number
      }
    | undefined

  if (!binding) return null
  const label = binding.primaryLabel ?? binding.items?.[0]?.label ?? ''
  const count = binding.count ?? binding.items?.length ?? 0
  const items = binding.items ?? []

  return <MetricTemplate label={label} count={count} items={items} />
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
      className="group relative rounded-[var(--radius)] border border-border/40 bg-card/70 p-4 shadow-sm backdrop-blur-md transition-all duration-300 hover:scale-[1.01] hover:border-[var(--accent-orange)]/30 hover:shadow-md"
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
