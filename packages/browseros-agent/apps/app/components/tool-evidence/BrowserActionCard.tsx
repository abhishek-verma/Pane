/**
 * STUB for merge with tool-vis/ui-cards (Task 8).
 * Public props match the plan; replace with full media/lightbox card on merge.
 */
import type { FC } from 'react'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { ToolStatusIcon } from './ToolStatusIcon'

export const BrowserActionCard: FC<{ evidence: ToolEvidence }> = ({
  evidence,
}) => {
  const browser = evidence.browser
  if (!browser) return null

  return (
    <div className="w-full rounded-md border border-border/60 bg-card/40 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <ToolStatusIcon state={evidence.state} />
        <span className="min-w-0 flex-1 truncate text-xs">
          {browser.caption}
        </span>
      </div>
      {evidence.errorText ? (
        <p className="mt-1 line-clamp-2 text-[11px] text-destructive">
          {evidence.errorText}
        </p>
      ) : null}
      {browser.pageDiffSummary ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {browser.pageDiffSummary}
        </p>
      ) : null}
    </div>
  )
}
