import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { migrateConversationsToServer } from '@/lib/conversations/migrateConversationsToServer'
import {
  type ChatHistoryListItem,
  deleteChatConversation,
  fetchChatHistoryList,
} from '@/lib/conversations/server-chat-history'
import { removeConversationExecutionHistory } from '@/lib/execution-history/storage'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

const HISTORY_QUERY_KEY = 'sidepanel-chat-history'

export function useServerChatHistory(enabled = true) {
  const {
    baseUrl,
    isLoading: urlLoading,
    error: urlError,
  } = useAgentServerUrl()
  const queryClient = useQueryClient()

  // One-time migration of legacy chrome.storage transcripts.
  useEffect(() => {
    if (!baseUrl || urlLoading) return
    void migrateConversationsToServer({ baseUrl })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: [HISTORY_QUERY_KEY] })
      })
      .catch(() => {
        // Migration failures should not block the history UI; the next
        // mount retries until the migrated flag is set.
      })
  }, [baseUrl, urlLoading, queryClient])

  const query = useQuery<ChatHistoryListItem[], Error>({
    queryKey: [HISTORY_QUERY_KEY, baseUrl],
    queryFn: () => fetchChatHistoryList(baseUrl),
    enabled: Boolean(baseUrl) && !urlLoading && enabled,
  })

  const removeMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      if (!baseUrl) throw new Error('Agent server URL not configured.')
      await deleteChatConversation(conversationId, baseUrl)
      await removeConversationExecutionHistory(conversationId)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [HISTORY_QUERY_KEY] })
    },
  })

  return {
    conversations: query.data ?? [],
    isLoading: query.isLoading || urlLoading,
    error: query.error ?? urlError,
    refetch: query.refetch,
    removeConversation: async (id: string) => {
      await removeMutation.mutateAsync(id)
    },
  }
}

export function invalidateServerChatHistory(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return queryClient.invalidateQueries({ queryKey: [HISTORY_QUERY_KEY] })
}
