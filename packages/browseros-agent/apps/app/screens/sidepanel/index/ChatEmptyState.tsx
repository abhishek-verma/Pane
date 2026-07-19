import { Sparkles } from 'lucide-react'
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
        'm-0! flex h-full flex-col items-center justify-center space-y-4 text-center opacity-0 transition-all duration-700',
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
      )}
    >
      <Sparkles className="mb-1 h-5 w-5 text-[var(--accent-orange)]" />
      <div>
        <h2 className="mb-1 font-semibold text-base tracking-tight">
          {mode === 'chat' ? 'Chat with this page' : 'Agent at your service'}
        </h2>
        <p className="max-w-[220px] text-muted-foreground text-xs">
          {mode === 'chat'
            ? 'Ask questions about the current page or any topic'
            : 'Let AI automate tasks and browse for you'}
        </p>
      </div>

      <div className="mt-6 grid w-full max-w-[260px] grid-cols-1">
        {suggestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion.display}
            onClick={() => onSuggestionClick(suggestion.prompt)}
            className="agent-suggestion group text-muted-foreground"
          >
            {suggestion.display}
            <span className="opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {suggestion.icon}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
