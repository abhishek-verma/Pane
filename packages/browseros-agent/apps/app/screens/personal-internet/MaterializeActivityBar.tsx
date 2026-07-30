/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Sticky footer while BTF materialize runs: rolling agent lines + open/approve.
 */

import type { FC } from 'react'
import type { MaterializeActivityLine } from './materializeActivity'
import { PiRailAction } from './PiChrome'

export type PendingMaterializeApproval = {
  toolName: string
  preview: string
  approveToken: string
  denyToken: string
}

export const MaterializeActivityBar: FC<{
  lines: MaterializeActivityLine[]
  needsApproval: boolean
  pendingApproval: PendingMaterializeApproval | null
  openingOwner: boolean
  resolvingApproval: boolean
  onOpenOwner: () => void
  onApprove: () => void
  onDeny: () => void
}> = ({
  lines,
  needsApproval,
  pendingApproval,
  openingOwner,
  resolvingApproval,
  onOpenOwner,
  onApprove,
  onDeny,
}) => (
  <div className="sticky bottom-0 z-10 border-border border-t bg-background/95 px-5 py-3 backdrop-blur-sm">
    {needsApproval ? (
      <div className="mb-2 font-mono text-[11px] text-[var(--signal)] tracking-wide">
        Blocked on approval
        {pendingApproval?.toolName ? ` · ${pendingApproval.toolName}` : ''}. The
        page cannot finish until you approve or deny.
      </div>
    ) : null}
    <div className="flex items-end gap-4">
      <div className="min-w-0 flex-1 space-y-1">
        {lines.length === 0 ? (
          <div className="font-mono text-[11px] text-muted-foreground tracking-wide">
            Owner agent starting…
          </div>
        ) : (
          lines.map((line) => (
            <div
              key={`${line.kind}:${line.text}`}
              className="truncate font-mono text-[11px] text-muted-foreground tracking-wide"
            >
              {line.text}
            </div>
          ))
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        {pendingApproval ? (
          <div className="flex gap-2">
            <PiRailAction
              disabled={resolvingApproval}
              onClick={onApprove}
              className="border-[var(--signal)] text-[var(--signal)]"
            >
              Approve
            </PiRailAction>
            <PiRailAction disabled={resolvingApproval} onClick={onDeny}>
              Deny
            </PiRailAction>
          </div>
        ) : null}
        <PiRailAction disabled={openingOwner} onClick={onOpenOwner}>
          {openingOwner ? 'Opening…' : 'Open owner agent'}
        </PiRailAction>
      </div>
    </div>
  </div>
)
