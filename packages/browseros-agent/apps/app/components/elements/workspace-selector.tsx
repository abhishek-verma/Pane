import { Check, Folder, FolderOpen, Globe, X } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { cn } from '@/lib/utils'
import type { WorkspaceFolder } from '@/lib/workspace/workspace-storage'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'

export const WorkspacePickerContent: FC<{ onDone: () => void }> = ({
  onDone,
}) => {
  const [filterText, setFilterText] = useState('')
  const {
    recentFolders,
    selectedFolder,
    selectFolder,
    addFolder,
    removeFolder,
    clearSelection,
  } = useWorkspace()

  const query = filterText.toLowerCase()
  const filteredFolders = recentFolders.filter(
    (f) =>
      f.name.toLowerCase().includes(query) ||
      f.path.toLowerCase().includes(query),
  )

  const handleChooseFolder = async () => {
    try {
      const adapter = getBrowserOSAdapter()
      const result = await adapter.choosePath({ type: 'folder' })

      if (!result) {
        return
      }

      const folder: WorkspaceFolder = {
        id: crypto.randomUUID(),
        name: result.name,
        path: result.path,
        addedAt: Date.now(),
      }

      await addFolder(folder)
      onDone()
    } catch {
      // User cancelled or API not available - silently ignore
    }
  }

  const handleSelectFolder = async (folder: WorkspaceFolder) => {
    if (selectedFolder?.id === folder.id) {
      await clearSelection()
    } else {
      await selectFolder(folder)
    }
    onDone()
  }

  const handleRemoveFolder = async (e: React.MouseEvent, folderId: string) => {
    e.stopPropagation()
    await removeFolder(folderId)
  }

  const handleUseDefault = async () => {
    await clearSelection()
    onDone()
  }

  return (
    <Command
      className="min-h-0 [&_svg:not([class*='text-'])]:text-muted-foreground"
      shouldFilter={false}
    >
      <CommandInput
        autoFocus
        aria-label="Search folders"
        placeholder="Search folders…"
        className="h-9"
        value={filterText}
        onValueChange={setFilterText}
      />
      <CommandList className="max-h-64 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <CommandGroup>
          <CommandItem
            value="no-workspace"
            onSelect={handleUseDefault}
            className="flex items-center gap-3 px-3 py-2"
          >
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span className="block text-sm">No workspace</span>
              <span className="block text-muted-foreground text-xs">
                AI works with tabs only
              </span>
            </div>
            {!selectedFolder && (
              <Check className="h-4 w-4 shrink-0 text-[var(--accent-orange)]" />
            )}
          </CommandItem>
        </CommandGroup>

        {filteredFolders.length > 0 && (
          <CommandGroup>
            <div className="my-2 px-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Recent
            </div>
            {filteredFolders.map((folder) => (
              <CommandItem
                key={folder.id}
                value={`${folder.id} ${folder.name} ${folder.path}`}
                onSelect={() => handleSelectFolder(folder)}
                className="group flex items-center gap-3 px-3 py-2"
              >
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">
                    {folder.name}
                  </span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {folder.path}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {selectedFolder?.id === folder.id && (
                    <Check className="h-4 w-4 text-[var(--accent-orange)]" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => handleRemoveFolder(e, folder.id)}
                    className={cn(
                      'rounded p-0.5 transition-opacity hover:bg-muted-foreground/20',
                      'opacity-0 group-hover:opacity-100',
                    )}
                    aria-label={`Remove ${folder.name} from recents`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandEmpty>No folders found</CommandEmpty>
      </CommandList>

      <div className="shrink-0 border-border/50 border-t">
        <button
          type="button"
          onClick={handleChooseFolder}
          className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
        >
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>Choose a different folder</span>
        </button>
      </div>
    </Command>
  )
}
