import { useQuery } from '@tanstack/react-query'
import { Bot, Clock, MessageSquare, Search } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { backgroundAgentLabel } from '@/lib/conversations/background-agent-label'
import {
  type ChatHistoryListItem,
  fetchChatHistoryList,
} from '@/lib/conversations/server-chat-history'
import { cn } from '@/lib/utils'
import { SidebarBranding } from './SidebarBranding'
import { SidebarNavigation } from './SidebarNavigation'
import { SidebarUserFooter } from './SidebarUserFooter'
import { WorkspaceSidebarSwitcher } from './WorkspaceSidebarSwitcher'

export interface AppSidebarProps {
  expanded?: boolean
  onOpenShortcuts?: () => void
}

function ChatRow({
  chat,
  isActive,
}: {
  chat: ChatHistoryListItem
  isActive: boolean
}) {
  const isBackground = Boolean(chat.isBackground)
  return (
    <Link
      to={`/home/chat?conversationId=${chat.id}`}
      className={cn(
        'flex items-start gap-2 rounded-md px-3 py-2 font-medium text-xs transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-muted-foreground',
      )}
    >
      {isBackground ? (
        <Bot className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
      )}
      <span className="flex min-w-0 flex-1 flex-col text-left leading-snug">
        {isBackground ? (
          <span className="font-mono text-[9px] text-[var(--signal)] uppercase tracking-wide">
            {backgroundAgentLabel(chat.backgroundSource)}
          </span>
        ) : null}
        <span className="truncate">{chat.previewText || 'Empty chat'}</span>
      </span>
    </Link>
  )
}

export const AppSidebar: FC<AppSidebarProps> = ({
  expanded = false,
  onOpenShortcuts,
}) => {
  const [searchParams] = useSearchParams()
  const activeConversationId = searchParams.get('conversationId')
  const [searchQuery, setSearchQuery] = useState('')

  const { data: historyList = [] } = useQuery<ChatHistoryListItem[]>({
    queryKey: ['sidepanel-chat-history'],
    queryFn: () => fetchChatHistoryList(),
    staleTime: 30000,
  })

  const filteredHistory = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return historyList.filter((item) =>
      item.previewText.toLowerCase().includes(q),
    )
  }, [historyList, searchQuery])

  const backgroundChats = useMemo(
    () =>
      filteredHistory
        .filter((c) => c.isBackground)
        .sort((a, b) => b.lastMessagedAt - a.lastMessagedAt)
        .slice(0, 8),
    [filteredHistory],
  )

  const recentChats = useMemo(
    () => filteredHistory.filter((c) => !c.isBackground).slice(0, 10),
    [filteredHistory],
  )

  return (
    <div
      className={cn(
        'flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-all duration-200 ease-in-out',
        expanded ? 'w-64' : 'w-14',
      )}
    >
      <SidebarBranding expanded={expanded} />
      <SidebarNavigation expanded={expanded} />

      {/* Middle Zone: Recent Chats */}
      {expanded ? (
        <div className="flex min-h-0 flex-1 flex-col border-t px-2 py-3">
          {backgroundChats.length > 0 ? (
            <>
              <div className="mb-2 flex items-center gap-1.5 px-3 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
                <Bot className="size-3" />
                <span>Background agents</span>
              </div>
              <div className="mb-3 space-y-0.5">
                {backgroundChats.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === activeConversationId}
                  />
                ))}
              </div>
            </>
          ) : null}

          <div className="mb-2 flex items-center gap-1.5 px-3 font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
            <Clock className="size-3" />
            <span>Recent Chats</span>
          </div>

          <div className="relative mb-2 px-1">
            <Search className="absolute top-2.5 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-md border border-input bg-transparent pr-3 pl-8 text-xs ring-offset-background file:border-0 file:bg-transparent file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="styled-scrollbar flex-1 space-y-0.5 overflow-y-auto pr-1">
            {recentChats.length === 0 && backgroundChats.length === 0 ? (
              <p className="px-3 py-4 text-center text-muted-foreground text-xs">
                No chats found
              </p>
            ) : recentChats.length === 0 ? (
              <p className="px-3 py-2 text-muted-foreground text-xs">
                No recent chats
              </p>
            ) : (
              recentChats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  isActive={chat.id === activeConversationId}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-2 border-t py-3">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground">
                  <Clock className="size-4" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Recent Chats</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      <WorkspaceSidebarSwitcher expanded={expanded} />
      <SidebarUserFooter
        expanded={expanded}
        onOpenShortcuts={onOpenShortcuts}
      />
    </div>
  )
}
