/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Streamdown's default link-safety modal uses `position: fixed` without a
 * portal. Inside the sidepanel chat (transforms / overflow / stick-to-bottom),
 * that containing block is the scrolled transcript — the dialog appears
 * mid-history off-screen. Render through our Dialog portal instead.
 */

import { Check, Copy, ExternalLink } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { LinkSafetyConfig, LinkSafetyModalProps } from 'streamdown'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

function StreamdownExternalLinkModal({
  isOpen,
  onClose,
  onConfirm,
  url,
}: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be unavailable; ignore.
    }
  }, [url])

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ExternalLink className="size-5" />
            Open external link?
          </DialogTitle>
          <DialogDescription>
            You&apos;re about to visit an external website.
          </DialogDescription>
        </DialogHeader>
        <div className="break-all rounded-md bg-muted p-3 font-mono text-sm">
          {url}
        </div>
        <DialogFooter className="sm:justify-stretch">
          <Button
            type="button"
            variant="outline"
            className="flex-1 gap-2"
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <>
                <Check className="size-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy link
              </>
            )}
          </Button>
          <Button
            type="button"
            className="flex-1 gap-2"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            <ExternalLink className="size-3.5" />
            Open link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Stable config for Streamdown — avoid new object identity per message row. */
export const streamdownLinkSafety: LinkSafetyConfig = {
  enabled: true,
  // pi:// is first-class in Pane (Chromium rewrite). Skip the external modal;
  // Streamdown then window.open(pi://…) which the browser handles.
  onLinkCheck: (url) =>
    url.startsWith('pi://') ||
    url.startsWith('#/pi/') ||
    url.includes('/app.html#/pi/'),
  renderModal: (props) => <StreamdownExternalLinkModal {...props} />,
}
