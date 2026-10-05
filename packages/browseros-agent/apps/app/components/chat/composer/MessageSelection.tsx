import type { UIMessage } from 'ai'
import { Quote } from 'lucide-react'
import { composerMetadata } from '@/modules/chat/composer-message'

const PREVIEW_LENGTH = 200

export function MessageSelection({ message }: { message: UIMessage }) {
  const selection = composerMetadata(message)?.selection
  if (message.role !== 'user' || !selection?.text) return null

  const source = selection.pageTitle || selection.pageUrl
  const isLong = selection.text.length > PREVIEW_LENGTH

  return (
    <aside
      aria-label="Selected text"
      className="mb-2 min-w-0 rounded-lg border border-border/60 bg-background/50 p-2.5 text-xs"
    >
      <div className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
        <Quote className="size-3.5 shrink-0" aria-hidden="true" />
        <span>Selected text</span>
      </div>
      {source && (
        <div
          className="mb-1 truncate text-muted-foreground"
          title={selection.pageUrl || source}
        >
          {source}
        </div>
      )}
      {isLong ? (
        <details className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="block whitespace-pre-wrap break-words leading-relaxed group-open:hidden">
              {selection.text.slice(0, PREVIEW_LENGTH)}…
            </span>
            <span className="mt-1 block text-muted-foreground group-open:hidden">
              Show full selection
            </span>
            <span className="hidden text-muted-foreground group-open:block">
              Show less
            </span>
          </summary>
          <blockquote className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">
            {selection.text}
          </blockquote>
        </details>
      ) : (
        <blockquote className="whitespace-pre-wrap break-words leading-relaxed">
          {selection.text}
        </blockquote>
      )}
    </aside>
  )
}
