export interface HistoryConversation {
  id: string
  lastMessagedAt: number
  lastUserMessage: string
  isBackground?: boolean
  backgroundSource?: string | null
}

export type TimeGroup = 'today' | 'thisWeek' | 'thisMonth' | 'older'

export interface GroupedConversations {
  background: HistoryConversation[]
  today: HistoryConversation[]
  thisWeek: HistoryConversation[]
  thisMonth: HistoryConversation[]
  older: HistoryConversation[]
}
