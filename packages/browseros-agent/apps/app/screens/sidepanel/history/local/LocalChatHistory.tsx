import type { FC } from 'react'
import { useMemo } from 'react'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'
import { ConversationList } from '../components/ConversationList'
import type { HistoryConversation } from '../components/types'
import { groupConversations } from '../components/utils'
import { useServerChatHistory } from '../server/useServerChatHistory'

/**
 * Sidepanel history list backed by server SQLite (`GET /chat/history`).
 * Legacy chrome.storage transcripts are migrated once on mount.
 */
export const LocalChatHistory: FC = () => {
  const {
    conversations: serverConversations,
    removeConversation,
    isLoading,
  } = useServerChatHistory()
  const { conversationId: activeConversationId } = useChatSessionContext()

  const conversations = useMemo<HistoryConversation[]>(() => {
    return serverConversations.map((conv) => ({
      id: conv.id,
      lastMessagedAt: conv.lastMessagedAt,
      lastUserMessage: conv.previewText || 'New conversation',
    }))
  }, [serverConversations])

  const groupedConversations = useMemo(
    () => groupConversations(conversations),
    [conversations],
  )

  if (isLoading && conversations.length === 0) {
    return (
      <div className="px-4 py-6 text-muted-foreground text-sm">
        Loading conversations…
      </div>
    )
  }

  return (
    <ConversationList
      groupedConversations={groupedConversations}
      activeConversationId={activeConversationId}
      onDelete={removeConversation}
    />
  )
}
