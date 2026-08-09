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

  it('round-trips a stored conversationId', async () => {
    await setLastActiveConversation('conv-123')
    expect(await getLastActiveConversation()).toBe('conv-123')
  })

  it('clears the stored conversationId', async () => {
    await setLastActiveConversation('conv-123')
    await clearLastActiveConversation()
    expect(await getLastActiveConversation()).toBeNull()
  })
})
