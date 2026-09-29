import { beforeEach, expect, it, mock } from 'bun:test'
import type { ChatHistoryListItem } from './server-chat-history'

let history: ChatHistoryListItem[] = []
let runs: Array<{ conversationId?: string }> | null = []
let posts: string[][] = []
let failBackfill = false
let backfillWait: Promise<void> | undefined
let failStorage = false
mock.module('@wxt-dev/storage', () => ({
  storage: {
    getItem: async () => {
      if (failStorage) throw new Error('storage unavailable')
      return runs
    },
  },
}))
mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://localhost',
}))
mock.module('@/lib/browseros/agent-fetch', () => ({
  agentFetch: async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)).conversationIds)
      if (failBackfill) throw new Error('offline')
      await backfillWait
      return Response.json({ updated: 1 })
    }
    return Response.json(history)
  },
}))
const { fetchChatHistoryList } = await import('./server-chat-history')
beforeEach(() => {
  history = []
  runs = []
  posts = []
  failBackfill = false
  backfillWait = undefined
  failStorage = false
})
const chat = (id: string): ChatHistoryListItem => ({
  id,
  lastMessagedAt: 1,
  previewText: 'Same user prompt',
})
it('repairs known legacy scheduled chats while keeping personal chats in recents', async () => {
  history = [
    chat('job'),
    chat('personal'),
    { ...chat('harvest'), isBackground: true, backgroundSource: 'pi-harvest' },
  ]
  runs = [{ conversationId: 'job' }, { conversationId: 'harvest' }, {}]
  const result = await fetchChatHistoryList()
  expect(
    result.filter((item) => !item.isBackground).map((item) => item.id),
  ).toEqual(['personal'])
  expect(result[0]?.backgroundSource).toBe('schedule')
  expect(result[2]?.backgroundSource).toBe('pi-harvest')
  expect(posts).toEqual([['job']])
})
it('keeps durable classification after local run history is pruned without repeating backfill', async () => {
  history = [
    { ...chat('job'), isBackground: true, backgroundSource: 'schedule' },
    chat('personal'),
  ]
  runs = null
  expect((await fetchChatHistoryList())[0]?.isBackground).toBe(true)
  expect(posts).toEqual([])
})
it('still separates legacy jobs when backfill fails and batches large histories', async () => {
  history = Array.from({ length: 105 }, (_, i) => chat(String(i)))
  runs = history.map((item) => ({ conversationId: item.id }))
  failBackfill = true
  expect(
    (await fetchChatHistoryList()).every((item) => item.isBackground),
  ).toBe(true)
  expect(posts.map((batch) => batch.length)).toEqual([100, 5])
})

it('renders fetched history without waiting for a stalled backfill', async () => {
  history = [chat('job'), chat('personal')]
  runs = [{ conversationId: 'job' }]
  const pending = Promise.withResolvers<void>()
  backfillWait = pending.promise
  try {
    const result = await Promise.race([
      fetchChatHistoryList(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('history blocked by backfill')), 100),
      ),
    ])
    expect(result[0]?.isBackground).toBe(true)
    expect(result[1]?.isBackground).toBeUndefined()
  } finally {
    pending.resolve()
  }
})
it('still returns server history when legacy storage is unavailable', async () => {
  history = [chat('personal')]
  failStorage = true
  expect(await fetchChatHistoryList()).toEqual(history)
  expect(posts).toEqual([])
})
