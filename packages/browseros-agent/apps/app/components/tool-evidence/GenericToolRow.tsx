import { ChevronDown } from 'lucide-react'
import { type FC, useEffect, useRef, useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { extractToolOutput } from '@/lib/tool-evidence/extract-output'
import {
  getCachedToolOutputText,
  setCachedToolOutputText,
} from '@/lib/tool-evidence/tool-media-cache'
import type { ToolEvidence } from '@/lib/tool-evidence/types'
import { cn } from '@/lib/utils'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { ToolStatusIcon } from './ToolStatusIcon'

export const GenericToolRow: FC<{
  evidence: ToolEvidence
  conversationId?: string
}> = ({ evidence, conversationId }) => {
  const [open, setOpen] = useState(false)
  const cached = getCachedToolOutputText(evidence.toolCallId)
  const [fullOutput, setFullOutput] = useState<string | null>(cached ?? null)
  const [loadingFull, setLoadingFull] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const loadingRef = useRef(false)
  const { baseUrl: serverBaseUrl } = useAgentServerUrl()
  const g = evidence.generic
  const title = g?.title ?? evidence.title
  const spilled = g?.spilled === true

  useEffect(() => {
    const hit = getCachedToolOutputText(evidence.toolCallId)
    if (hit != null) setFullOutput(hit)
  }, [evidence.toolCallId])

  useEffect(() => {
    if (!open || !spilled || fullOutput != null || loadingRef.current) return
    if (!conversationId || !serverBaseUrl) return
    let cancelled = false
    loadingRef.current = true
    setLoadingFull(true)
    setLoadError(null)
    void agentFetch(
      `${serverBaseUrl}/chat/${encodeURIComponent(conversationId)}/tool-outputs/${encodeURIComponent(evidence.toolCallId)}`,
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load output (${res.status})`)
        const raw = await res.text()
        try {
          const parsed = JSON.parse(raw) as unknown
          const extracted = extractToolOutput(parsed)
          return extracted.text || raw
        } catch {
          return raw
        }
      })
      .then((text) => {
        if (cancelled) return
        setCachedToolOutputText(evidence.toolCallId, text)
        setFullOutput(text)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err))
        }
      })
      .finally(() => {
        loadingRef.current = false
        if (!cancelled) setLoadingFull(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    open,
    spilled,
    fullOutput,
    conversationId,
    serverBaseUrl,
    evidence.toolCallId,
  ])

  const resultText = spilled ? (fullOutput ?? g?.outputText) : g?.outputText

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
            {resultText || loadingFull || loadError ? (
              <div className="min-w-0">
                <p className="mb-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                  Result
                  {spilled && !fullOutput && !loadingFull ? ' (preview)' : ''}
                </p>
                {loadingFull ? (
                  <p className="text-[11px] text-muted-foreground">
                    Loading full output…
                  </p>
                ) : null}
                {loadError ? (
                  <p className="text-[11px] text-destructive">{loadError}</p>
                ) : null}
                {resultText ? (
                  <pre className="agent-peek-scroll agent-peek-scroll-pre p-2 font-mono text-[11px]">
                    {resultText}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
