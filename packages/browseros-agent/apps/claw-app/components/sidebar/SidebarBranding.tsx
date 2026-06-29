import { PaneMark } from '@/components/branding/PaneMark'
import { PaneWordmark } from '@/components/branding/PaneWordmark'
import { cn } from '@/lib/utils'

export interface SidebarBrandingProps {
  expanded?: boolean
}

/** Compact Pane mark in the sidebar; wordmark fades in when expanded. */
export function SidebarBranding({ expanded = false }: SidebarBrandingProps) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 px-3">
      <PaneMark
        size={32}
        className="shrink-0 text-accent"
        aria-label="Pane"
        role="img"
      />
      <span
        className={cn(
          'truncate transition-opacity duration-200',
          expanded ? 'opacity-100' : 'opacity-0',
        )}
      >
        <PaneWordmark size="sm" />
      </span>
    </div>
  )
}
