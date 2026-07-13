import { Folder, Globe } from 'lucide-react'
import type { FC } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'

export interface WorkspaceSidebarSwitcherProps {
  expanded?: boolean
}

export const WorkspaceSidebarSwitcher: FC<WorkspaceSidebarSwitcherProps> = ({
  expanded = true,
}) => {
  const { selectedFolder } = useWorkspace()

  return (
    <div className="border-t px-2 py-2">
      <Link
        to={
          selectedFolder
            ? `/settings/workspaces/${selectedFolder.id}`
            : '/settings/workspaces'
        }
        className={cn(
          'flex h-9 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md px-3 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        )}
      >
        {selectedFolder ? (
          <Folder className="size-4 shrink-0 text-[var(--accent-orange)]" />
        ) : (
          <Globe className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            'min-w-0 truncate transition-opacity duration-200',
            expanded ? 'opacity-100' : 'opacity-0',
          )}
        >
          {selectedFolder ? selectedFolder.name : 'No workspace'}
        </span>
      </Link>
    </div>
  )
}
