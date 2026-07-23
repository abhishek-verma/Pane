import { FileText, Globe } from 'lucide-react'
import type { FC } from 'react'
import type {
  AITabAction,
  BrowserOSAction,
  ChatAction,
} from '@/lib/chat-actions/types'

export interface UserActionMessageProps {
  action: ChatAction
}

interface AttachedTabsProps {
  tabs: chrome.tabs.Tab[]
}

const AttachedTabs: FC<AttachedTabsProps> = ({ tabs }) => {
  return (
    tabs.length > 0 && (
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab, idx) => (
          <div
            key={tab.id || idx}
            className="flex items-center gap-1.5 rounded-md border border-border/50 bg-accent/50 px-2 py-1"
          >
            {tab.favIconUrl ? (
              <img
                src={tab.favIconUrl}
                alt={tab.title}
                className="h-3 w-3 object-contain"
              />
            ) : (
              <Globe className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="max-w-[150px] truncate text-xs">{tab.title}</span>
          </div>
        ))}
      </div>
    )
  )
}

const AITabActionCard: FC<{ action: AITabAction }> = ({ action }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent-orange)]/10">
          <FileText className="h-4 w-4 text-[var(--accent-orange)]" />
        </div>
        <div className="flex-1">
          <div className="font-medium text-foreground text-sm">
            {action.name}
          </div>
          {action.description && (
            <div className="text-muted-foreground text-xs">
              {action.description}
            </div>
          )}
        </div>
      </div>
      <AttachedTabs tabs={action.tabs} />
    </div>
  )
}

const BrowserOSActionCard: FC<{ action: BrowserOSAction }> = ({ action }) => {
  // Render like a normal user bubble: message text + optional tab pills.
  // Do not show Bot/Agent chrome — that reads as agent authorship.
  return (
    <div className="flex flex-col gap-2">
      <div className="text-foreground text-sm">{action.message}</div>
      {action.tabs ? <AttachedTabs tabs={action.tabs} /> : null}
    </div>
  )
}

export const UserActionMessage: FC<UserActionMessageProps> = ({ action }) => {
  switch (action.type) {
    case 'ai-tab':
      return <AITabActionCard action={action} />
    case 'browseros':
      return <BrowserOSActionCard action={action} />
    default:
      return null
  }
}
