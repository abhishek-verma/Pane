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
  clearActiveRepairConversation,
  getActiveRepairConversation,
  setActiveRepairConversation,
} = await import('./activeRepairStorage')

describe('activeRepairStorage', () => {
  beforeEach(() => {
    storageState.clear()
  })

  it('returns null when no repair is tracked for a page', async () => {
    expect(await getActiveRepairConversation('page-1')).toBeNull()
  })

  it('round-trips a conversationId keyed by pageId', async () => {
    await setActiveRepairConversation('page-1', 'conv-1')
    expect(await getActiveRepairConversation('page-1')).toBe('conv-1')
    expect(await getActiveRepairConversation('page-2')).toBeNull()
  })

  it('clears the tracked conversationId', async () => {
    await setActiveRepairConversation('page-1', 'conv-1')
    await clearActiveRepairConversation('page-1')
    expect(await getActiveRepairConversation('page-1')).toBeNull()
  })
})
