import { beforeEach, describe, expect, it, mock } from 'bun:test'

const storageState = new Map<string, unknown>()

mock.module('@wxt-dev/storage', () => ({
  storage: {
    getItem: async (key: string) => storageState.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      storageState.set(key, value)
    },
  },
}))

const {
  clearLastActiveConversation,
  getLastActiveConversation,
  setLastActiveConversation,
} = await import('./lastActiveConversationStorage')

describe('lastActiveConversationStorage', () => {
  beforeEach(() => {
    storageState.clear()
  })

  it('returns null when nothing was stored', async () => {
    expect(await getLastActiveConversation()).toBeNull()
  })

  it('round-trips a stored conversationId with its tab', async () => {
    await setLastActiveConversation('conv-123', 7)
    expect(await getLastActiveConversation()).toEqual({
      conversationId: 'conv-123',
      tabId: 7,
    })
  })

  it('round-trips a null tabId for per-window panels', async () => {
    await setLastActiveConversation('conv-123', null)
    expect(await getLastActiveConversation()).toEqual({
      conversationId: 'conv-123',
      tabId: null,
    })
  })

  it('clears the stored conversationId', async () => {
    await setLastActiveConversation('conv-123', 7)
    await clearLastActiveConversation()
    expect(await getLastActiveConversation()).toBeNull()
  })
})
