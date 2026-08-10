/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { storage } from '@wxt-dev/storage'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { openPiHref } from '@/lib/personal-internet/open-pi-href'
import { parsePiHref } from '@/lib/personal-internet/pi-href'
import { cn } from '@/lib/utils'
import { autoOpenPiPageAndFollowPanel } from './pi-page-card-auto-open'

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
   * Navigate once when pi_open delivers its result.
   * Idempotent across side-panel remounts via extension session storage —
   * history revisits never re-navigate even though the isStreaming guard
   * was removed.
   */
  autoOpen?: boolean
  autoOpenKey?: string
  /**
   * The conversation this card belongs to — passed explicitly (not read
   * from context) so agent-driven auto-open follows the panel to the
   * specific triggering conversation, never an ambient/global one, and
   * so this component stays free of the chat-session hook's heavy
   * dependency graph.
   */
  conversationId?: string
  /** @deprecated no longer used for navigation gating; kept for call-site compat */
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

let openedKeys = new Set<string>()

/** Test seam: reset the in-memory guard between unit tests. */
export function __resetPiPageCardAutoOpenForTests(): void {
  openedKeys = new Set<string>()
}

/**
 * Tool-event idempotency: one auto-open per toolCall key per browser
 * session. Each side-panel open/close creates a fresh document (a fresh JS
 * realm and a fresh page-scoped window.sessionStorage) — using
 * window.sessionStorage here let the auto-navigate re-fire every single
 * time the panel reopened on a conversation whose last message happened to
 * be a pi_open call. chrome.storage.session (via the WXT `session:` prefix,
 * same pattern as perWindowConversationStorage) is scoped to the extension,
 * not the document, and survives that remount.
 */
export async function markOpened(key: string): Promise<boolean> {
  if (openedKeys.has(key)) return false
  openedKeys.add(key)
  try {
    const storageKey = `session:browseros.pi.auto_open.${key}` as const
    if (await storage.getItem<boolean>(storageKey)) return false
    await storage.setItem(storageKey, true)
  } catch {
    // Storage unavailable — the in-memory guard above still applies for
    // this mount's lifetime.
  }
  return true
}

export const PiPageCard: FC<PiPageCardProps> = ({
  href,
  preview,
  className,
  autoOpen = false,
  autoOpenKey,
  conversationId,
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
    // Fire once when the tool result lands (autoOpen=true from pi_open).
    // isStreaming may already be false when pi_open is the last tool in the
    // turn — the markOpened idempotency guard prevents re-navigation on
    // history revisit, so the live-stream guard is not needed here.
    if (!autoOpen || !autoOpenKey) return
    let cancelled = false
    void markOpened(autoOpenKey).then((shouldOpen) => {
      if (cancelled || !shouldOpen) return
      void autoOpenPiPageAndFollowPanel(href, conversationId ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [autoOpen, autoOpenKey, href, conversationId])

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
