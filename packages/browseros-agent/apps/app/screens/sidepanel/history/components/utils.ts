import dayjs from 'dayjs'
import type {
  GroupedConversations,
  HistoryConversation,
  TimeGroup,
} from './types'

export const TIME_GROUP_LABELS: Record<TimeGroup, string> = {
  today: 'Today',
  thisWeek: 'This Week',
  thisMonth: 'This Month',
  older: 'Older',
}

const getTimeGroup = (timestamp: number): TimeGroup => {
  const date = dayjs(timestamp)
  const now = dayjs()

  if (date.isSame(now, 'day')) return 'today'
  if (date.isSame(now, 'week')) return 'thisWeek'
  if (date.isSame(now, 'month')) return 'thisMonth'
  return 'older'
}

export const groupConversations = (
  conversations: HistoryConversation[],
): GroupedConversations => {
  const groups: GroupedConversations = {
    background: [],
    today: [],
    thisWeek: [],
    thisMonth: [],
    older: [],
  }

  for (const conversation of conversations) {
    if (conversation.isBackground) {
      groups.background.push(conversation)
      continue
    }
    const group = getTimeGroup(conversation.lastMessagedAt)
    groups[group].push(conversation)
  }

  // Newest background agents first
  groups.background.sort((a, b) => b.lastMessagedAt - a.lastMessagedAt)

  return groups
}
