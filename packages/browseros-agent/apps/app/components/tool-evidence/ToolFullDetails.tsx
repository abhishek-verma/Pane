import { useEffect, useRef, useState } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { ViewportBlock } from './ViewportBlock'

/** Deliberately local state: closing or virtualizing the row releases the full
 * body. Never feed fetched display details back into executable chat state.
 */
export function ToolFullDetails({
  conversationId,
  toolCallId,
  onLoaded,
}: {
  conversationId?: string
  toolCallId: string
  onLoaded?: (details: { input: Record<string, unknown> }) => void
}) {
  const { baseUrl } = useAgentServerUrl()
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  // A reused row must not show details fetched for a different conversation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity changes invalidate the fetch and its display state
  useEffect(() => {
    setText(null)
    setError(null)
    setLoading(false)
    return () => controller.current?.abort()
  }, [conversationId, toolCallId])
  if (!conversationId || !baseUrl) return null
  const load = async () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setError(null)
    try {
      const response = await agentFetch(
        `${baseUrl}/chat/${encodeURIComponent(conversationId)}/tool-details/${encodeURIComponent(toolCallId)}`,
        { signal: request.signal },
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          body?.error ?? `Could not load tool details (${response.status}).`,
        )
      }
      const details = await response.json()
      if (!request.signal.aborted) {
        if (onLoaded) {
          if (
            !details.input ||
            typeof details.input !== 'object' ||
            Array.isArray(details.input)
          )
            throw new Error(
              'Tool parameters are unavailable. Retry loading full details.',
            )
          onLoaded(details)
        } else setText(JSON.stringify(details, null, 2))
      }
    } catch (error) {
      if (!request.signal.aborted)
        setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }
  return (
    <div className="min-w-0 text-xs">
      <button
        type="button"
        className="py-1 text-muted-foreground underline hover:text-foreground"
        disabled={loading}
        onClick={text === null ? () => void load() : () => setText(null)}
      >
        {loading
          ? 'Loading full details…'
          : text === null
            ? error
              ? 'Retry loading full details'
              : 'Load full details'
            : 'Close full details'}
      </button>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {text !== null ? (
        <div className="agent-peek-scroll max-h-96 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px]">
          {Array.from({ length: Math.ceil(text.length / 4000) }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: offsets in an immutable fetched string never reorder
            <ViewportBlock key={index} estimatedHeight={500}>
              {text.slice(index * 4000, (index + 1) * 4000)}
            </ViewportBlock>
          ))}
        </div>
      ) : null}
    </div>
  )
}
