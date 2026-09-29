import type { FC } from 'react'
import { cn } from '@/lib/utils'
import {
  AGENT_SUGGESTIONS,
  CHAT_SUGGESTIONS,
  type ChatMode,
} from '@/modules/chat/chat-types'

export interface ChatEmptyStateProps {
  mode: ChatMode
  mounted: boolean
  onSuggestionClick: (suggestion: string) => void
}

export const ChatEmptyState: FC<ChatEmptyStateProps> = ({
  mode,
  mounted,
  onSuggestionClick,
}) => {
  const suggestions = mode === 'chat' ? CHAT_SUGGESTIONS : AGENT_SUGGESTIONS

  return (
    <div
      className={cn(
        'm-0! flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-6 text-center opacity-0 transition-opacity duration-300 motion-reduce:transition-none',
        mounted ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div>
        <h2 className="mb-2 font-medium text-[22px] tracking-tight">
          What can I help with?
        </h2>
        <p className="max-w-[300px] text-muted-foreground text-sm">
          Ask a question, add a file, or bring in a page.
        </p>
      </div>

      <div className="mt-7 grid w-full max-w-[280px] grid-cols-1 gap-1">
        {suggestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion.display}
            onClick={() => onSuggestionClick(suggestion.prompt)}
            className="group flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {suggestion.display}
            <span className="shrink-0 opacity-40 transition-opacity group-hover:opacity-100">
              {suggestion.icon}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
