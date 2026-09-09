import { Globe, X } from 'lucide-react'
import type { FC } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

export interface ChatAttachedTabsProps {
  tabs: chrome.tabs.Tab[]
  onRemoveTab: (tabId?: number) => void
}

export const ChatAttachedTabs: FC<ChatAttachedTabsProps> = ({
  tabs,
  onRemoveTab,
}) => {
  if (tabs.length === 0) return null

  return (
    <div className="px-3 pt-2">
      <div className="styled-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex min-w-0 max-w-[200px] flex-shrink-0 items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2 py-1"
          >
            <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border border-border bg-background">
              {tab.favIconUrl ? (
                <img src={tab.favIconUrl} alt="" className="h-3 w-3" />
              ) : (
                <Globe className="h-3 w-3 text-muted-foreground" />
              )}
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex-1 truncate text-left font-medium text-foreground text-xs"
                  title={tab.url}
                >
                  {tab.title}
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" className="w-72 space-y-2 p-4">
                <p className="font-medium text-sm">{tab.title}</p>
                <p className="break-all text-muted-foreground text-xs">
                  {tab.url}
                </p>
                <p className="text-muted-foreground text-xs">
                  Attached as a page reference. Pane can read it when needed.
                </p>
                {tab.url?.match(/^https?:/) && (
                  <a
                    href={tab.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-xs underline"
                  >
                    Open source
                  </a>
                )}
              </PopoverContent>
            </Popover>
            <button
              type="button"
              onClick={() => onRemoveTab(tab.id)}
              className="flex-shrink-0 rounded p-0.5 transition-colors hover:bg-background"
              title="Remove tab"
            >
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
