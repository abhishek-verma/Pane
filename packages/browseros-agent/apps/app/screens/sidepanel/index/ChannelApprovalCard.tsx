/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Channel/unattended approval card for chat when the transcript has no
 * AI SDK approval-requested part (background harvest/trigger/schedule).
 */

import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import type { ConversationPendingApproval } from '@/modules/chat/use-conversation-pending-approvals'

function stripPreviewPrefix(preview: string): string {
  return preview.replace(/^Needs approval:\s*/i, '').trim()
}

export const ChannelApprovalCard: FC<{
  approval: ConversationPendingApproval
  busy?: boolean
  note?: string | null
  onApprove: () => void
  onAllowForChat: () => void
  onDeny: () => void
}> = ({ approval, busy, note, onApprove, onAllowForChat, onDeny }) => {
  const action = stripPreviewPrefix(approval.preview) || approval.toolName
  return (
    <div className="mx-4 mb-3 rounded-md border border-[var(--signal)]/40 bg-card p-3">
      <div className="font-medium text-sm">
        Background agent paused — needs approval
      </div>
      <div className="mt-1 whitespace-pre-wrap text-muted-foreground text-xs leading-5">
        Action: {action}
      </div>
      {note ? (
        <div className="mt-2 font-mono text-[11px] text-[var(--signal)] tracking-wide">
          {note}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onApprove} variant="default">
          Approve
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={onAllowForChat}
          variant="default"
        >
          Allow for this chat
        </Button>
        <Button size="sm" disabled={busy} onClick={onDeny} variant="outline">
          Deny
        </Button>
      </div>
    </div>
  )
}
