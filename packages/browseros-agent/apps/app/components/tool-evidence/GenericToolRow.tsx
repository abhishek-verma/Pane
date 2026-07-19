import { ChevronDown } from 'lucide-react'
import { type FC, useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { ToolStatusIcon } from './ToolStatusIcon'

export const GenericToolRow: FC<{ evidence: ToolEvidence }> = ({
  evidence,
}) => {
  const [open, setOpen] = useState(false)
  const g = evidence.generic
  const title = g?.title ?? evidence.title

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-full min-w-0">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left text-muted-foreground text-xs hover:text-foreground">
        <ToolStatusIcon state={evidence.state} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 space-y-2 pb-2 pl-5">
        {evidence.errorText ? (
          <pre className="agent-peek-scroll max-h-32 whitespace-pre-wrap p-2 font-mono text-[11px] text-destructive">
            {evidence.errorText}
          </pre>
        ) : null}
        {g?.detailsUnavailable ? (
          <p className="text-[11px] text-muted-foreground">{g.subtitle}</p>
        ) : (
          <>
            {g?.inputJson ? (
              <div className="min-w-0">
                <p className="mb-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  Parameters
                </p>
                <pre className="agent-peek-scroll agent-peek-scroll-pre p-2 font-mono text-[11px]">
                  {g.inputJson}
                </pre>
              </div>
            ) : null}
            {g?.outputText ? (
              <div className="min-w-0">
                <p className="mb-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  Result
                </p>
                <pre className="agent-peek-scroll agent-peek-scroll-pre p-2 font-mono text-[11px]">
                  {g.outputText}
                </pre>
              </div>
            ) : null}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
