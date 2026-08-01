/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Resolve whether the open conversation is a background/scheduled agent.
 */

import { useQuery } from '@tanstack/react-query'
import { fetchChatHistoryList } from '@/lib/conversations/server-chat-history'

export function useConversationBackgroundMeta(
  conversationId: string | null | undefined,
) {
  const historyQuery = useQuery({
    queryKey: ['sidepanel-chat-history'],
    queryFn: () => fetchChatHistoryList(),
    staleTime: 30_000,
  })

  const match = (historyQuery.data ?? []).find((c) => c.id === conversationId)

  return {
    isBackground: Boolean(match?.isBackground),
    backgroundSource: match?.backgroundSource ?? null,
  }
}
