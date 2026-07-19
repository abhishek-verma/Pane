import { useQueryClient } from '@tanstack/react-query'
import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import { executeWidgetAction } from '@/lib/widget-actions'

export interface ApprovalItem {
  id: string
  toolName: string
  preview?: string
  runId: string
  approveToken: string
  denyToken: string
}

export interface ApprovalGateTemplateProps {
  items: ApprovalItem[]
}

export const ApprovalGateTemplate: FC<ApprovalGateTemplateProps> = ({
  items,
}) => {
  const queryClient = useQueryClient()
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const handleResolve = async (
    id: string,
    token: string,
    resolution: 'approve' | 'deny',
  ) => {
    setResolvingId(id)
    await executeWidgetAction(
      { type: 'resolve-approval', approvalId: id, token, resolution },
      queryClient,
    )
    setResolvingId(null)
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground text-xs">No pending actions.</p>
  }

  return (
    <div className="space-y-3">
      {items.slice(0, 3).map((item) => (
        <div
          key={item.id}
          className="space-y-2 rounded-md border border-border/40 bg-muted/30 p-2.5"
        >
          <div className="flex items-center justify-between font-semibold text-xs">
            <span className="text-[10px] text-[var(--accent-orange)] uppercase tracking-wider">
              {item.toolName ?? 'Action'}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Run ID: {item.runId?.slice(0, 8)}
            </span>
          </div>
          {item.preview ? (
            <p className="line-clamp-2 break-all rounded bg-background/50 p-1.5 font-mono text-muted-foreground text-xs">
              {item.preview}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-6 border-green-500/20 bg-green-500/10 px-2.5 font-semibold text-[10px] text-green-500 hover:bg-green-500/20 hover:text-green-600"
              disabled={resolvingId === item.id}
              onClick={() =>
                handleResolve(item.id, item.approveToken, 'approve')
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 border-red-500/20 bg-red-500/10 px-2.5 font-semibold text-[10px] text-red-500 hover:bg-red-500/20 hover:text-red-600"
              disabled={resolvingId === item.id}
              onClick={() => handleResolve(item.id, item.denyToken, 'deny')}
            >
              Deny
            </Button>
          </div>
        </div>
      ))}
      {items.length > 3 && (
        <p className="pl-1 font-semibold text-[10px] text-muted-foreground">
          +{items.length - 3} more waiting
        </p>
      )}
    </div>
  )
}
