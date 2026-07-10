import { describe, expect, it, mock } from 'bun:test'
import type { UIMessage } from 'ai'

const importChatConversations = mock(
  async () =>
    ({ imported: 1, skipped: 0 }) as {
      imported: number
      skipped: number
    },
)
const getAgentServerUrl = mock(async () => 'http://127.0.0.1:9100')

let migratedFlag = false
let localConversations: Array<{
  id: string
  messages: UIMessage[]
  lastMessagedAt: number
}> = []

mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl,
}))

mock.module('./server-chat-history', () => ({
  importChatConversations,
}))

mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => migratedFlag,
      setValue: async (value: boolean) => {
        migratedFlag = value
      },
    }),
  },
}))

mock.module('./conversationStorage', () => ({
  conversationStorage: {
    getValue: async () => localConversations,
    setValue: async (
      value: Array<{
        id: string
        messages: UIMessage[]
        lastMessagedAt: number
      }>,
    ) => {
      localConversations = value
    },
  },
}))

const { migrateConversationsToServer } = await import(
  './migrateConversationsToServer'
)

describe('migrateConversationsToServer', () => {
  it('imports local conversations once and clears chrome.storage', async () => {
    migratedFlag = false
    localConversations = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        lastMessagedAt: 1,
        messages: [
          {
            id: 'm1',
            role: 'user',
            parts: [{ type: 'text', text: 'hi' }],
          },
        ],
      },
    ]
    importChatConversations.mockClear()

    const first = await migrateConversationsToServer({
      baseUrl: 'http://127.0.0.1:9100',
    })
    expect(first).toEqual({ imported: 1, skipped: 0, alreadyDone: false })
    expect(importChatConversations).toHaveBeenCalledTimes(1)
    expect(localConversations).toEqual([])
    expect(migratedFlag).toBe(true)

    const second = await migrateConversationsToServer({
      baseUrl: 'http://127.0.0.1:9100',
    })
    expect(second.alreadyDone).toBe(true)
    expect(importChatConversations).toHaveBeenCalledTimes(1)
  })
})
