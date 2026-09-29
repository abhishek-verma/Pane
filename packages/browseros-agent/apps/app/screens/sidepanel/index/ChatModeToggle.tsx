import { MessageSquare, MousePointer2 } from 'lucide-react'
import type { FC } from 'react'
import { cn } from '@/lib/utils'
import type { ChatMode } from '@/modules/chat/chat-types'

export interface ChatModeToggleProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
}

export const ChatModeToggle: FC<ChatModeToggleProps> = ({
  mode,
  onModeChange,
}) => (
  <fieldset
    aria-label="Response mode"
    className="flex gap-1 rounded-xl bg-muted/60 p-1"
  >
    {(
      [
        { value: 'chat', label: 'Chat', Icon: MessageSquare },
        { value: 'agent', label: 'Agent', Icon: MousePointer2 },
      ] as const
    ).map(({ value, label, Icon }) => (
      <button
        key={value}
        type="button"
        aria-pressed={mode === value}
        onClick={() => onModeChange(value)}
        className={cn(
          'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          mode === value
            ? 'bg-background font-medium text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Icon className="size-3.5" />
        {label}
      </button>
    ))}
  </fieldset>
)
