import type {
  ContentCursor,
  UiContentPage,
} from '@browseros/shared/ui-content-page'
import { useEffect, useRef, useState } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { ToolFullDetails } from './ToolFullDetails'

/** Explicit overflow reader. Only ONE small page is resident; next/previous
 * replaces it rather than appending an ever-growing copy to useChat state.
 */
export function MessageContentReader({
  conversationId,
  messageId,
}: {
  conversationId: string
  messageId: string
}) {
  const { baseUrl } = useAgentServerUrl()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<UiContentPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  const requestedCursor = useRef<ContentCursor | undefined>(undefined)
  useEffect(() => () => request.current?.abort(), [])
  const load = async (cursor?: ContentCursor) => {
    if (!baseUrl) return
    requestedCursor.current = cursor
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(null)
    try {
      const params = cursor
        ? `?part=${cursor.part}&offset=${cursor.offset}`
        : ''
      const response = await agentFetch(
        `${baseUrl}/chat/${encodeURIComponent(conversationId)}/message-content/${encodeURIComponent(messageId)}${params}`,
        { signal: controller.signal },
      )
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          body?.error ?? `Could not load content (${response.status}).`,
        )
      }
      const next = (await response.json()) as UiContentPage
      if (!controller.signal.aborted) setPage(next)
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }
  const close = () => {
    request.current?.abort()
    setOpen(false)
    setPage(null)
    setLoading(false)
    setError(null)
  }
  return (
    <div className="my-2 rounded-lg border p-3 text-sm">
      <button
        type="button"
        className="underline"
        onClick={() => {
          if (open) close()
          else {
            setOpen(true)
            void load()
          }
        }}
      >
        {open ? 'Close full turn' : 'View full turn'}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground text-xs">
            Read saved content in pages. Loading a page replaces the previous
            one.
          </p>
          {loading ? <p role="status">Loading content…</p> : null}
          {error ? (
            <div role="alert">
              {error}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void load(requestedCursor.current)}
              >
                Retry
              </button>
            </div>
          ) : null}
          {page ? (
            <>
              <p className="text-xs">
                Section {page.index + 1} of {page.totalParts}
                {page.part.type === 'reasoning' ? ' · Reasoning' : ''}
              </p>
              <pre className="agent-peek-scroll max-h-96 overflow-auto whitespace-pre-wrap break-words p-2 font-sans text-sm">
                {page.part.text ?? JSON.stringify(page.part, null, 2)}
              </pre>
              {page.part.toolCallId ? (
                <ToolFullDetails
                  key={page.part.toolCallId}
                  conversationId={conversationId}
                  toolCallId={page.part.toolCallId}
                />
              ) : null}
              <div className="flex gap-4 text-xs">
                <button
                  type="button"
                  disabled={loading || !page.previous}
                  onClick={() => page.previous && void load(page.previous)}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  disabled={loading || !page.next}
                  onClick={() => page.next && void load(page.next)}
                >
                  Next page
                </button>
                <button
                  type="button"
                  disabled={loading || (page.index === 0 && !page.previous)}
                  onClick={() => void load({ part: 0, offset: 0 })}
                >
                  First section
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
