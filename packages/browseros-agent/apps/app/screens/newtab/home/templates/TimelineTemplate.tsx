import type { FC } from 'react'
import { executeWidgetAction } from '@/lib/widget-actions'

export interface PageItem {
  title?: string
  uri?: string
}

export interface TimelineTemplateProps {
  pages: PageItem[]
}

function getDomain(uri?: string): string {
  if (!uri) return ''
  try {
    const url = new URL(uri)
    return url.hostname.replace('www.', '')
  } catch {
    return ''
  }
}

export const TimelineTemplate: FC<TimelineTemplateProps> = ({ pages }) => {
  // Deduplicate by title
  const uniquePages: PageItem[] = []
  const titlesSet = new Set<string>()
  for (const p of pages) {
    const displayTitle = p.title ?? p.uri ?? ''
    if (displayTitle && !titlesSet.has(displayTitle)) {
      titlesSet.add(displayTitle)
      uniquePages.push(p)
    }
  }

  const handleOpenItem = (uri?: string) => {
    if (uri) {
      void executeWidgetAction({ type: 'open-context-item', itemId: uri, uri })
    }
  }

  if (uniquePages.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">No recent work found.</p>
    )
  }

  return (
    <div className="space-y-2">
      {uniquePages.slice(0, 4).map((p, i) => {
        const domain = getDomain(p.uri)
        return (
          <button
            key={p.uri ?? String(i)}
            type="button"
            onClick={() => handleOpenItem(p.uri)}
            className="group flex w-full cursor-pointer items-center justify-between gap-3 rounded border border-transparent p-1.5 text-left text-sm transition-all hover:border-border/30 hover:bg-muted/40"
          >
            <div className="flex min-w-0 items-center gap-2">
              {domain && (
                <span className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 font-bold text-[9px] text-muted-foreground uppercase tracking-wider">
                  {domain}
                </span>
              )}
              <p className="truncate font-medium text-foreground/80 text-xs group-hover:text-foreground">
                {p.title ?? p.uri}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}
