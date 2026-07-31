/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Check, Copy, ExternalLink } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { openPiHref } from '@/lib/personal-internet/open-pi-href'
import { parsePiHref } from '@/lib/personal-internet/pi-href'
import { cn } from '@/lib/utils'

export type PiPagePreview = {
  title?: string
  siteName?: string
  pulseLine?: string
  kind?: 'site' | 'page' | 'entity' | 'temp' | 'library'
}

export type PiPageCardProps = {
  href: string
  preview?: PiPagePreview | null
  className?: string
  /**
   * Navigate once for a live pi_open during an active stream.
   * History revisits never auto-open (requires isStreaming).
   */
  autoOpen?: boolean
  autoOpenKey?: string
  isStreaming?: boolean
}

function kindLabel(kind?: PiPagePreview['kind']): string {
  switch (kind) {
    case 'site':
      return 'Site'
    case 'entity':
      return 'Entity'
    case 'temp':
      return 'Temp'
    case 'library':
      return 'Library'
    default:
      return 'Page'
  }
}

const openedKeys = new Set<string>()

function markOpened(key: string): boolean {
  if (openedKeys.has(key)) return false
  try {
    const storageKey = `pane.pi.autoOpen.${key}`
    if (sessionStorage.getItem(storageKey)) return false
    sessionStorage.setItem(storageKey, '1')
  } catch {
    // sessionStorage unavailable — fall through to in-memory only
  }
  openedKeys.add(key)
  return true
}

export const PiPageCard: FC<PiPageCardProps> = ({
  href,
  preview,
  className,
  autoOpen = false,
  autoOpenKey,
  isStreaming = false,
}) => {
  const [copied, setCopied] = useState(false)

  const parts = parsePiHref(href)
  const title =
    preview?.title?.trim() ||
    (parts?.kind === 'entity'
      ? parts.entityKey
      : parts?.kind === 'library'
        ? 'My sites'
        : href.replace(/^pi:\/\//, ''))

  const subtitle =
    preview?.pulseLine?.trim() ||
    (preview?.siteName && preview.siteName !== title
      ? preview.siteName
      : undefined)

  useEffect(() => {
    // Only during a live stream — reopening a finished chat must not navigate.
    if (!autoOpen || !isStreaming || !autoOpenKey) return
    if (!markOpened(autoOpenKey)) return
    void openPiHref(href)
  }, [autoOpen, autoOpenKey, href, isStreaming])

  const handleOpen = () => {
    void openPiHref(href)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div
      className={cn(
        'agent-trace my-2 border border-border bg-muted/20 px-3 py-3',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center border border-border bg-background font-mono text-[10px] text-foreground uppercase tracking-[0.08em]">
          PI
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
              {kindLabel(preview?.kind ?? parts?.kind)}
            </span>
            <span className="truncate font-mono text-[10px] text-muted-foreground/80">
              {href}
            </span>
          </div>
          <p className="mt-1 truncate font-medium text-foreground text-sm">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
              {subtitle}
            </p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.06em]"
              onClick={handleOpen}
            >
              <ExternalLink className="size-3" />
              Open
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2.5 font-mono text-[10px] uppercase tracking-[0.06em]"
              onClick={() => void handleCopy()}
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
