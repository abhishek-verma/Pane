import { beforeEach, expect, it, mock } from 'bun:test'
import type { UIMessage } from 'ai'

mock.module('@wxt-dev/storage', () => ({ storage: {} }))
mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://localhost',
}))
const fetchRead = mock(async (_url: string, _init?: RequestInit) =>
  Response.json({ messages: [], hasMore: false }),
)
mock.module('@/lib/browseros/agent-fetch', () => ({ agentFetch: fetchRead }))
const { fetchChatMessagePage } = await import('./server-chat-history')
beforeEach(() => fetchRead.mockReset())

it('reopens a locally remembered draft with no server session as empty history', async () => {
  fetchRead.mockImplementation(async () =>
    Response.json({ error: 'Conversation not found' }, { status: 404 }),
  )
  const page = await fetchChatMessagePage('unsent-draft', {
    allowMissing: true,
  })
  expect(page).toEqual({ messages: [], hasMore: false })
  expect(fetchRead).toHaveBeenCalledTimes(1)
})

it('does not turn a server failure into an empty successful restore', async () => {
  fetchRead.mockImplementation(async () => new Response(null, { status: 500 }))
  await expect(
    fetchChatMessagePage('existing', { allowMissing: true }),
  ).rejects.toThrow('500')
  expect(fetchRead).toHaveBeenCalledTimes(1)
})

it('keeps missing-page failures for callers that require an existing transcript', async () => {
  fetchRead.mockImplementation(async () => new Response(null, { status: 404 }))
  await expect(fetchChatMessagePage('existing')).rejects.toThrow('404')
})

it('loads saved messages without probing or starting a provider', async () => {
  const messages: UIMessage[] = [
    {
      id: 'a',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Saved Codex reply' }],
    },
  ]
  fetchRead.mockImplementation(async (url) => {
    expect(url).toContain('/chat/codex-chat/messages')
    return Response.json({ messages, hasMore: true })
  })
  expect(
    await fetchChatMessagePage('codex-chat', { allowMissing: true }),
  ).toEqual({ messages, hasMore: true })
  expect(fetchRead).toHaveBeenCalledTimes(1)
})

it('aborts a pending restore so a late response cannot be applied after New Chat', async () => {
  let finish!: (response: Response) => void
  let signal: AbortSignal | undefined
  fetchRead.mockImplementation((_url, init) => {
    signal = init?.signal ?? undefined
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const navigation = new AbortController()
  const pending = fetchChatMessagePage('old-chat', {
    signal: navigation.signal,
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  navigation.abort()
  await expect(pending).rejects.toThrow()
  expect(signal?.aborted).toBe(true)
  finish(Response.json({ messages: [], hasMore: false }))
})
