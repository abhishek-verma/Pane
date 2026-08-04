/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Living Grid chrome for PI places (spec 21) — mono top rail, hairline actions.
 */

import { type FC, type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { normalizePiHref } from '@/lib/personal-internet/open-pi-href'
import {
  isPiDocument,
  isPiRoutePath,
  navigateAppShell,
  navigatePiDocument,
} from '@/lib/personal-internet/pi-document'
import { cn } from '@/lib/utils'

export const PiTopRail: FC<{
  crumbs: string[]
  status?: ReactNode
  actions?: ReactNode
}> = ({ crumbs, status, actions }) => (
  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-border border-b px-5 py-3">
    <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
      <span className="text-foreground/80">PANE</span>
      {crumbs.map((c) => (
        <span key={c}>
          <span className="mx-1.5 text-border">/</span>
          {c}
        </span>
      ))}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      {status}
      {actions}
    </div>
  </div>
)

export const PiRailAction: FC<{
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  to?: string
  className?: string
  variant?: 'default' | 'primary' | 'destructive'
}> = ({ children, onClick, disabled, to, className, variant = 'default' }) => {
  const base =
    'inline-flex h-7 items-center px-2.5 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors disabled:cursor-not-allowed disabled:opacity-50'
  const variantClass =
    variant === 'primary'
      ? 'border border-foreground bg-foreground text-background hover:bg-foreground/85'
      : variant === 'destructive'
        ? 'border border-destructive/60 bg-transparent text-destructive hover:bg-destructive/10'
        : 'border border-border bg-transparent text-foreground hover:bg-muted/60'
  const classes = cn(base, variantClass, className)
  if (to) {
    // Cross-document hops hard-navigate so HashRouter alone cannot leave PI
    // stranded on the NTP shell (or Home stranded on pi.html).
    if (isPiDocument() && !isPiRoutePath(to)) {
      return (
        <button
          type="button"
          disabled={disabled}
          className={classes}
          onClick={() => navigateAppShell(to)}
        >
          {children}
        </button>
      )
    }
    if (!isPiDocument() && isPiRoutePath(to)) {
      return (
        <button
          type="button"
          disabled={disabled}
          className={classes}
          onClick={() => navigatePiDocument(to)}
        >
          {children}
        </button>
      )
    }
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={classes}
    >
      {children}
    </button>
  )
}

export const PiStatusDot: FC<{ label: string; live?: boolean }> = ({
  label,
  live = true,
}) => (
  <span className="inline-flex items-center gap-2 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
    <span
      className={cn(
        'size-1.5 rounded-full',
        live ? 'bg-signal' : 'bg-muted-foreground/50',
      )}
    />
    {label}
  </span>
)

export const PiSectionLabel: FC<{
  children: ReactNode
  className?: string
}> = ({ children, className }) => (
  <div
    className={cn(
      'font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]',
      className,
    )}
  >
    {children}
  </div>
)

/** Copy pi:// and bookmark the same address (Pane Chromium resolves it). */
export const PiLinkActions: FC<{
  href: string
  bookmarkTitle?: string
}> = ({ href, bookmarkTitle }) => {
  const [copied, setCopied] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const canonical = normalizePiHref(href) ?? href

  return (
    <>
      <PiRailAction
        onClick={() => {
          void navigator.clipboard.writeText(canonical).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </PiRailAction>
      <PiRailAction
        onClick={() => {
          if (typeof chrome === 'undefined' || !chrome.bookmarks?.create) {
            void navigator.clipboard.writeText(canonical)
            return
          }
          void chrome.bookmarks
            .create({
              title: bookmarkTitle?.trim() || canonical,
              url: canonical,
            })
            .then(() => {
              setBookmarked(true)
              window.setTimeout(() => setBookmarked(false), 1500)
            })
            .catch(() => {
              void navigator.clipboard.writeText(canonical)
            })
        }}
      >
        {bookmarked ? 'Bookmarked' : 'Bookmark'}
      </PiRailAction>
    </>
  )
}

export const PiAddressChip: FC<{ href: string }> = ({ href }) => {
  const canonical = normalizePiHref(href) ?? href
  return (
    <span
      className="max-w-[12rem] truncate font-mono text-[10px] text-muted-foreground normal-case tracking-[0.02em]"
      title={canonical}
    >
      {canonical}
    </span>
  )
}
