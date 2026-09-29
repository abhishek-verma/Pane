import {
  ArrowLeft,
  Camera,
  ChevronRight,
  FilePlus2,
  Folder,
  Layers,
  PlugZap,
  Plus,
  SlidersHorizontal,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { TabPickerContent } from '@/components/elements/tab-picker-popover'
import { WorkspacePickerContent } from '@/components/elements/workspace-selector'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { ChatMode } from '@/modules/chat/chat-types'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'
import { ChatModeToggle } from '@/screens/sidepanel/index/ChatModeToggle'

const panelClass =
  'flex max-h-(--radix-popover-content-available-height) w-[min(22rem,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border-border/60 p-0 shadow-lg'
const triggerClass =
  'flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted data-[state=open]:text-foreground'

function MenuRow({
  icon,
  title,
  detail,
  onClick,
  trailing,
}: {
  icon: ReactNode
  title: string
  detail?: string
  onClick: () => void
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{title}</span>
        {detail && (
          <span className="block truncate text-muted-foreground text-xs">
            {detail}
          </span>
        )}
      </span>
      {trailing}
    </button>
  )
}

function PanelHeading({
  title,
  onBack,
}: {
  title: string
  onBack?: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-3 py-3">
      {onBack && (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" />
        </button>
      )}
      <h2 className="font-medium text-sm">{title}</h2>
    </div>
  )
}

export function ChatComposerControls({
  selectedTabs,
  onToggleTab,
  onFiles,
  onScreenshot,
  mode = 'agent',
  onModeChange,
}: {
  selectedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  onFiles: () => void
  onScreenshot: () => void
  mode?: ChatMode
  onModeChange?: (mode: ChatMode) => void
}) {
  const [addView, setAddView] = useState<'menu' | 'tabs' | null>(null)
  const [settingsView, setSettingsView] = useState<'menu' | 'workspace' | null>(
    null,
  )
  const { selectedFolder } = useWorkspace()
  return (
    <>
      <Popover
        open={addView !== null}
        onOpenChange={(open) => setAddView(open ? 'menu' : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Add attachments"
            title="Add tabs, files or screenshots"
            className={triggerClass}
            onClick={() => setSettingsView(null)}
          >
            <Plus className="size-[18px]" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className={panelClass}
          aria-label={addView === 'tabs' ? 'Attach tabs' : 'Add to message'}
        >
          <PanelHeading
            title={addView === 'tabs' ? 'Attach tabs' : 'Add to message'}
            onBack={addView === 'tabs' ? () => setAddView('menu') : undefined}
          />
          {addView === 'tabs' ? (
            <TabPickerContent
              selectedTabs={selectedTabs}
              onToggleTab={onToggleTab}
              onDone={() => setAddView(null)}
            />
          ) : (
            <div className="min-h-0 overflow-y-auto px-1.5 pb-1.5">
              <MenuRow
                icon={<Layers className="size-4" />}
                title="Tabs"
                detail="Choose from your open pages"
                onClick={() => setAddView('tabs')}
                trailing={
                  <span className="text-muted-foreground text-xs">@</span>
                }
              />
              <MenuRow
                icon={<FilePlus2 className="size-4" />}
                title="Files & photos"
                onClick={() => {
                  setAddView(null)
                  onFiles()
                }}
              />
              <MenuRow
                icon={<Camera className="size-4" />}
                title="Screenshot"
                onClick={() => {
                  setAddView(null)
                  onScreenshot()
                }}
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
      <Popover
        open={settingsView !== null}
        onOpenChange={(open) => setSettingsView(open ? 'menu' : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Chat settings"
            title={`Chat settings · ${mode === 'agent' ? 'Agent' : 'Chat'} mode`}
            className={triggerClass}
            onClick={() => setAddView(null)}
          >
            <SlidersHorizontal className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          className={panelClass}
          aria-label={
            settingsView === 'workspace' ? 'Workspace folder' : 'Chat settings'
          }
        >
          <PanelHeading
            title={
              settingsView === 'workspace'
                ? 'Workspace folder'
                : 'Chat settings'
            }
            onBack={
              settingsView === 'workspace'
                ? () => setSettingsView('menu')
                : undefined
            }
          />
          {settingsView === 'workspace' ? (
            <WorkspacePickerContent onDone={() => setSettingsView(null)} />
          ) : (
            <div className="min-h-0 overflow-y-auto">
              {onModeChange && (
                <div className="px-3 pb-3">
                  <ChatModeToggle mode={mode} onModeChange={onModeChange} />
                  <p className="mt-2 text-muted-foreground text-xs">
                    {mode === 'agent'
                      ? 'Browse and take actions for your task.'
                      : 'Read pages and answer questions.'}
                  </p>
                </div>
              )}
              <div className="border-border/50 border-t p-1.5">
                <MenuRow
                  icon={<Folder className="size-4" />}
                  title="Workspace folder"
                  detail={selectedFolder?.name ?? 'No folder selected'}
                  onClick={() => setSettingsView('workspace')}
                  trailing={
                    <ChevronRight className="size-3.5 text-muted-foreground" />
                  }
                />
                <MenuRow
                  icon={<PlugZap className="size-4" />}
                  title="Connected apps"
                  onClick={() => {
                    setSettingsView(null)
                    window.open(
                      chrome.runtime.getURL('/app.html#/settings/mcp'),
                      '_blank',
                    )
                  }}
                />
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  )
}
