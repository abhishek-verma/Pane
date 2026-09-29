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
    <div className="px-1 pt-1 pb-2">
      <div className="styled-scrollbar flex max-h-24 flex-wrap items-center gap-1.5 overflow-y-auto overscroll-contain">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-lg bg-muted/60 py-1 pr-1 pl-2"
          >
            <div className="flex size-4 shrink-0 items-center justify-center">
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
                  className="min-w-0 max-w-44 flex-1 truncate text-left text-muted-foreground text-xs hover:text-foreground"
                  title={tab.url}
                >
                  {tab.title}
                </button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                collisionPadding={12}
                className="max-h-(--radix-popover-content-available-height) w-[min(20rem,calc(100vw-24px))] space-y-2 overflow-y-auto rounded-xl p-4"
              >
                <p className="break-words font-medium text-sm">{tab.title}</p>
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
              className="flex size-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Remove ${tab.title || 'tab'}`}
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
