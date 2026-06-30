import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
} from 'lucide-react'
import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { cn } from '@/lib/utils'
import type { WorkspaceFolder } from '@/lib/workspace/workspace-storage'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'
import { useWorkspaceFileContent, useWorkspaceFiles } from './useWorkspaceFiles'

function joinPath(base: string, name: string): string {
  if (base === '.' || base === '') return name
  return `${base.replace(/\/$/, '')}/${name}`
}

function parentPath(path: string): string {
  if (path === '.' || !path.includes('/')) return '.'
  return path.replace(/\/[^/]+$/, '') || '.'
}

export const WorkspacesPage: FC = () => {
  const { id: routeWorkspaceId } = useParams()
  const navigate = useNavigate()
  const {
    recentFolders,
    selectedFolder,
    selectFolder,
    addFolder,
    removeFolder,
    updateFolder,
  } = useWorkspace()

  const activeFolder = useMemo(() => {
    if (routeWorkspaceId) {
      return recentFolders.find((f) => f.id === routeWorkspaceId) ?? null
    }
    return selectedFolder
  }, [routeWorkspaceId, recentFolders, selectedFolder])

  const [browsePath, setBrowsePath] = useState('.')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const { entries, loading, error } = useWorkspaceFiles(
    activeFolder?.path,
    browsePath,
  )
  const { content: fileContent, loading: fileLoading } =
    useWorkspaceFileContent(activeFolder?.path, selectedFile ?? undefined)

  const handleChooseFolder = async () => {
    try {
      const adapter = getBrowserOSAdapter()
      const result = await adapter.choosePath({ type: 'folder' })
      if (!result) return

      const folder: WorkspaceFolder = {
        id: crypto.randomUUID(),
        name: result.name,
        path: result.path,
        addedAt: Date.now(),
        scope: 'write',
        bucketId: 'default',
      }
      await addFolder(folder)
      navigate(`/workspaces/${folder.id}`)
    } catch {
      // cancelled
    }
  }

  const handleSelectWorkspace = async (folder: WorkspaceFolder) => {
    await selectFolder(folder)
    setBrowsePath('.')
    setSelectedFile(null)
    navigate(`/workspaces/${folder.id}`)
  }

  const handleRemove = async (folderId: string) => {
    await removeFolder(folderId)
    if (routeWorkspaceId === folderId) {
      navigate('/workspaces')
    }
  }

  const startRename = (folder: WorkspaceFolder) => {
    setEditingNameId(folder.id)
    setEditName(folder.name)
  }

  const commitRename = async (folderId: string) => {
    const name = editName.trim()
    if (name) {
      await updateFolder(folderId, { name })
    }
    setEditingNameId(null)
  }

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 p-6 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Workspaces</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Grant folders for the agent to read and write. Switch workspace to
            change the active root.
          </p>
        </div>
        <Button onClick={handleChooseFolder}>
          <Plus className="mr-2 size-4" />
          Add workspace
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-medium text-sm">Your workspaces</h2>
          {recentFolders.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No workspaces yet. Add a folder to get started.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentFolders.map((folder) => {
                const isActive =
                  activeFolder?.id === folder.id ||
                  selectedFolder?.id === folder.id
                return (
                  <li
                    key={folder.id}
                    className={cn(
                      'rounded-md border p-3 transition-colors',
                      isActive &&
                        'border-[var(--accent-orange)]/40 bg-muted/40',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <Folder className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        {editingNameId === folder.id ? (
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => commitRename(folder.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(folder.id)
                            }}
                            className="h-8"
                            autoFocus
                          />
                        ) : (
                          <button
                            type="button"
                            className="block truncate text-left font-medium text-sm hover:underline"
                            onClick={() => startRename(folder)}
                          >
                            {folder.name}
                          </button>
                        )}
                        <p className="truncate text-muted-foreground text-xs">
                          {folder.path}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Select
                            value={folder.scope ?? 'write'}
                            onValueChange={(scope: 'read' | 'write') =>
                              updateFolder(folder.id, { scope })
                            }
                          >
                            <SelectTrigger className="h-8 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="read">Read only</SelectItem>
                              <SelectItem value="write">
                                Read + write
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant={isActive ? 'default' : 'outline'}
                            onClick={() => handleSelectWorkspace(folder)}
                          >
                            {isActive ? 'Active' : 'Use'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => handleRemove(folder.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3 rounded-lg border p-4">
          <h2 className="font-medium text-sm">File browser</h2>
          {!activeFolder ? (
            <p className="text-muted-foreground text-sm">
              Select a workspace to browse files.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
                <button
                  type="button"
                  className="hover:text-foreground"
                  onClick={() => {
                    setBrowsePath('.')
                    setSelectedFile(null)
                  }}
                >
                  {activeFolder.name}
                </button>
                {browsePath !== '.' &&
                  browsePath.split('/').map((segment, index, parts) => {
                    const partial = parts.slice(0, index + 1).join('/')
                    return (
                      <span key={partial} className="flex items-center gap-1">
                        <ChevronRight className="size-3" />
                        <button
                          type="button"
                          className="hover:text-foreground"
                          onClick={() => {
                            setBrowsePath(partial)
                            setSelectedFile(null)
                          }}
                        >
                          {segment}
                        </button>
                      </span>
                    )
                  })}
              </div>

              {loading && (
                <p className="text-muted-foreground text-sm">Loading…</p>
              )}
              {error && (
                <p className="text-destructive text-sm">{error.message}</p>
              )}

              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {browsePath !== '.' && (
                  <li>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                      onClick={() => {
                        setBrowsePath(parentPath(browsePath))
                        setSelectedFile(null)
                      }}
                    >
                      <FolderOpen className="size-4 text-muted-foreground" />
                      ..
                    </button>
                  </li>
                )}
                {entries.map((entry) => (
                  <li key={entry.name}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                        selectedFile === joinPath(browsePath, entry.name) &&
                          'bg-muted',
                      )}
                      onClick={() => {
                        const fullPath = joinPath(browsePath, entry.name)
                        if (entry.type === 'dir') {
                          setBrowsePath(fullPath)
                          setSelectedFile(null)
                        } else {
                          setSelectedFile(fullPath)
                        }
                      }}
                    >
                      {entry.type === 'dir' ? (
                        <Folder className="size-4 text-muted-foreground" />
                      ) : (
                        <File className="size-4 text-muted-foreground" />
                      )}
                      <span className="truncate">{entry.name}</span>
                      {entry.type === 'file' && entry.size != null && (
                        <span className="ml-auto text-muted-foreground text-xs">
                          {entry.size} B
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {selectedFile && (
                <div className="space-y-2">
                  <p className="font-medium text-sm">{selectedFile}</p>
                  {fileLoading ? (
                    <p className="text-muted-foreground text-sm">Reading…</p>
                  ) : (
                    <pre className="max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                      {fileContent ?? '(empty)'}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <p className="text-muted-foreground text-xs">
        Manage trust pins in{' '}
        <Link to="/settings/customization" className="underline">
          Customize Pane
        </Link>
        . View consequential actions in the{' '}
        <Link to="/settings/action-log" className="underline">
          action log
        </Link>
        .
      </p>
    </div>
  )
}
