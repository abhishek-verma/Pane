import { expect, mock, test } from 'bun:test'
import type { UIMessage } from 'ai'

const fetcher = mock(
  async (_input?: RequestInfo | URL, _init?: RequestInit) => new Response(),
)
mock.module('@/lib/browseros/agent-fetch', () => ({ agentFetch: fetcher }))
mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://127.0.0.1:9999',
}))
mock.module('@/lib/conversations/server-chat-history', () => ({
  fetchChatMessagePage: async () => ({ messages: [], hasMore: false }),
}))
const attach = mock(async (input: any) => {
  await input.onEvent({ type: 'done', status: 'done' }, 10)
})
mock.module('@/lib/conversations/chat-turn-api', () => ({
  attachChatTurnStream: attach,
  cancelChatTurn: async () => ({ cancelled: true }),
  fetchActiveChatTurn: async () => null,
}))
const stored: Record<string, unknown> = {}
Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: stored[key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(stored, values)
        },
        remove: async (key: string) => {
          delete stored[key]
        },
      },
    },
  },
})
const { repositoryBackend } = await import('./backend')

test('the shared executor consumes real SDK chunks and completes even if HTTP remains open after finish', async () => {
  let cancelled = false
  fetcher.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const chunks = [
              { type: 'start', messageId: 'assistant' },
              { type: 'text-start', id: 'text' },
              { type: 'text-delta', id: 'text', delta: 'hello' },
              { type: 'text-end', id: 'text' },
              { type: 'finish', finishReason: 'stop' },
            ]
            for (const chunk of chunks)
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
              )
          },
          cancel() {
            cancelled = true
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream', 'x-turn-id': 'turn' },
        },
      ),
  )
  const snapshots: UIMessage[][] = []
  let receipt = false,
    chunkBeforeReceipt = false
  const result = await repositoryBackend.execute(
    'chat',
    { path: '/chat', body: { message: 'hello' } },
    [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
    AbortSignal.timeout(2000),
    async (event) => {
      if (event.type === 'accepted') {
        await new Promise((resolve) => setTimeout(resolve, 5))
        receipt = true
      } else if (!receipt) chunkBeforeReceipt = true
    },
    (messages) => snapshots.push(messages),
  )
  expect(result).toEqual({
    outcome: 'done',
    started: { conversationId: 'chat', turnId: 'turn' },
  })
  expect(snapshots.at(-1)?.at(-1)?.parts).toEqual([
    { type: 'text', text: 'hello', state: 'done' },
  ])
  expect(chunkBeforeReceipt).toBe(false)
  expect(cancelled).toBe(true)
})

test('the coordinator refuses arbitrary network destinations', async () => {
  await expect(
    repositoryBackend.execute(
      'chat',
      { path: 'https://elsewhere.invalid', body: {} },
      [],
      new AbortController().signal,
      () => {},
      () => {},
    ),
  ).rejects.toThrow('Unsupported chat endpoint')
})

test('confirmed completion recovers a decoder missing its finish frame', async () => {
  let decoderCancelled = false
  fetcher.mockImplementation(
    async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"type":"start","messageId":"assistant"}\n\n',
              ),
            )
            init?.signal?.addEventListener(
              'abort',
              () => {
                decoderCancelled = true
                controller.error(new DOMException('Aborted', 'AbortError'))
              },
              { once: true },
            )
          },
        }),
        {
          headers: {
            'content-type': 'text/event-stream',
            'x-turn-id': 'finished',
          },
        },
      ),
  )
  const at = Date.now()
  const result = await repositoryBackend.execute(
    'chat',
    { path: '/chat', body: {} },
    [],
    AbortSignal.timeout(4000),
    () => {},
    () => {},
  )
  expect(result.outcome).toBe('done')
  expect(decoderCancelled).toBe(true)
  expect(Date.now() - at).toBeLessThan(3500)
})

test('a harness turn survives the generic watchdog interval and uses scoped history, active, attach and cancel after recovery', async () => {
  const id = 'harness-conversation'
  const session = 'harness-session'
  const prefix = `/agents/agent/sessions/${session}`
  const urls: string[] = []
  let finished = false
  let stopped = false
  const sdkResponse = (delay: number) =>
    new Response(
      new ReadableStream({
        start(controller) {
          const emit = (chunk: unknown) =>
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`),
            )
          emit({ type: 'start' })
          emit({ type: 'text-start', id: 'text' })
          setTimeout(() => {
            emit({ type: 'text-delta', id: 'text', delta: 'harness reply' })
            emit({ type: 'text-end', id: 'text' })
            finished = true
            emit({ type: 'finish', finishReason: 'stop' })
          }, delay)
        },
      }),
      {
        headers: {
          'content-type': 'text/event-stream',
          'x-turn-id': 'harness-turn',
        },
      },
    )
  fetcher.mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    urls.push(url.pathname)
    if (url.pathname === '/agents/agent/sidepanel/chat')
      return sdkResponse(2200)
    if (url.pathname === prefix + '/chat/active')
      return Response.json({
        active: finished
          ? null
          : {
              turnId: 'harness-turn',
              status: 'running',
              startedAt: 1,
              lastSeq: 1,
              prompt: 'hello',
            },
      })
    if (url.pathname === prefix + '/chat/stream') {
      expect(url.searchParams.get('format')).toBe('ui')
      expect(init?.method).toBe('GET')
      return sdkResponse(0)
    }
    if (url.pathname === prefix + '/chat/cancel') {
      stopped = true
      return Response.json({ cancelled: true })
    }
    if (url.pathname === prefix + '/history')
      return Response.json({
        items: [
          { id: 'user', role: 'user', text: 'hello' },
          ...(finished
            ? [{ id: 'assistant', role: 'assistant', text: 'harness reply' }]
            : []),
        ],
      })
    throw new Error(`Unexpected endpoint ${url.pathname}`)
  })
  const attachesBefore = attach.mock.calls.length
  const snapshots: UIMessage[][] = []
  const result = await repositoryBackend.execute(
    id,
    {
      path: '/agents/agent/sidepanel/chat',
      body: { agentSessionId: session },
    },
    [],
    AbortSignal.timeout(5000),
    () => {},
    (messages) => snapshots.push(messages),
  )
  expect(result.outcome).toBe('done')
  expect(snapshots.at(-1)?.at(-1)?.id).toBe('harness-assistant:harness-turn')
  expect(urls).toContain(prefix + '/chat/active')
  expect(attach.mock.calls.length).toBe(attachesBefore)
  expect((await repositoryBackend.history(id, false)).messages.at(-1)?.id).toBe(
    'assistant',
  )
  const events: any[] = []
  // The binding is persisted, so receipt recovery needs only conversation/turn IDs.
  await repositoryBackend.attach(
    id,
    'harness-turn',
    AbortSignal.timeout(3000),
    (event) => {
      events.push(event)
    },
  )
  expect(events.at(-1)).toEqual({ type: 'done', status: 'done' })
  expect(
    events.at(-2).messages.map((message: UIMessage) => message.id),
  ).toEqual(['user', 'assistant'])
  expect(await repositoryBackend.cancel(id, 'stop')).toBe(true)
  expect(stopped).toBe(true)
  expect(urls.every((url) => url.startsWith('/agents/'))).toBe(true)
})

test('harness failures settle as paused even when history is unavailable', async () => {
  fetcher.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/history'))
      return new Response('unavailable', { status: 503 })
    if (path.endsWith('/active')) return Response.json({ active: null })
    return new Response(
      'data: {"type":"start"}\n\ndata: {"type":"error","errorText":"Authentication required"}\n\ndata: {"type":"finish","finishReason":"error"}\n\n',
      {
        headers: {
          'content-type': 'text/event-stream',
          'x-turn-id': 'failed-harness-turn',
        },
      },
    )
  })
  const result = await repositoryBackend.execute(
    'failed-harness',
    {
      path: '/agents/agent/sidepanel/chat',
      body: {},
    },
    [],
    AbortSignal.timeout(2000),
    () => {},
    () => {},
  )
  expect(result.outcome).toBe('paused')
  const events: any[] = []
  await repositoryBackend.attach(
    'failed-harness',
    'failed-harness-turn',
    AbortSignal.timeout(2000),
    (event) => {
      events.push(event)
    },
  )
  expect(events.at(-1)).toEqual({ type: 'done', status: 'error' })
})
