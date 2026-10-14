import { expect, mock, test } from 'bun:test'
import type { UIMessage } from 'ai'
import type { ChatActiveTurnInfo } from '../conversations/chat-turn-api'
import { ChatRepository, type RepositoryBackend } from './repository'

const message = (text: string): UIMessage => ({
  id: 'assistant',
  role: 'assistant',
  parts: [{ type: 'text', text }],
})
const turn = (id = 'turn'): ChatActiveTurnInfo => ({
  turnId: id,
  conversationId: 'chat',
  status: 'running',
  lastSeq: 0,
  startedAt: 1,
  prompt: null,
  truncated: false,
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 65))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function fixture(options?: { maxBytes: number; idleMs: number }) {
  const streams: Array<{
    signal: AbortSignal
    event: Parameters<RepositoryBackend['attach']>[3]
  }> = []
  const backend: RepositoryBackend = {
    history: mock(async () => ({
      messages: [message('history')],
      hasMore: false,
    })),
    active: mock(async () => null),
    attach: mock(async (_id, _turn, signal, event) => {
      streams.push({ signal, event })
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      )
    }),
    cancel: mock(async () => true),
    execute: mock(async () => ({ outcome: 'done' as const })),
    project: (messages) => messages,
  }
  return { backend, streams, repository: new ChatRepository(backend, options) }
}

test('two visible views share one stream, dedupe polls, and hidden views receive no snapshots', async () => {
  const { repository, backend, streams } = fixture()
  backend.active = mock(async () => turn())
  const first = mock(() => {}),
    second = mock(() => {})
  const a = repository.subscribe('chat', first),
    b = repository.subscribe('chat', second)
  await tick()
  expect(streams).toHaveLength(1)
  const before = first.mock.calls.length
  await repository.refresh('chat')
  expect(first).toHaveBeenCalledTimes(before)
  b.visibility(false)
  const hiddenBefore = second.mock.calls.length
  streams[0].event({ type: 'snapshot', messages: [message('live')] }, 1)
  await tick()
  expect(repository.peek('chat').messages).toEqual([message('live')])
  expect(second).toHaveBeenCalledTimes(hiddenBefore)
  a.dispose()
  expect(streams[0].signal.aborted).toBe(true)
  b.visibility(true)
  await tick()
  expect(streams).toHaveLength(2)
  b.dispose()
})

test('stale history cannot overwrite a live snapshot or a newly submitted message', async () => {
  const { repository, backend, streams } = fixture()
  const history = deferred<{ messages: UIMessage[]; hasMore: boolean }>()
  backend.history = () => history.promise
  backend.active = async () => turn()
  const view = repository.subscribe('chat', () => {})
  await new Promise((resolve) => setTimeout(resolve, 0))
  streams[0].event({ type: 'snapshot', messages: [message('new')] }, 3)
  history.resolve({ messages: [message('old')], hasMore: false })
  await tick()
  expect(repository.peek('chat').messages).toEqual([message('new')])
  // Out-of-order and duplicated frames are ignored.
  streams[0].event({ type: 'snapshot', messages: [message('obsolete')] }, 2)
  await tick()
  expect(repository.peek('chat').messages).toEqual([message('new')])
  view.dispose()
})

test('restoration does not wait for a stalled liveness probe', async () => {
  const { repository, backend } = fixture()
  const active = deferred<ChatActiveTurnInfo | null>()
  backend.active = () => active.promise
  const view = repository.subscribe('chat', () => {})
  expect((await repository.read('chat')).messages).toEqual([message('history')])
  active.resolve(null)
  await tick()
  view.dispose()
})

test('one conversation serializes execution while different conversations run independently', async () => {
  const { repository, backend } = fixture()
  const run = deferred<{ outcome: 'done' }>()
  backend.execute = mock(async () => run.promise)
  const request = { path: '/chat', body: {} }
  const a = repository.run('a', request, [message('a')])
  const b = repository.run('b', request, [message('b')])
  expect(repository.peek('a').busy).toBe(true)
  await expect(repository.run('a', request, [])).rejects.toThrow(
    'already has a running turn',
  )
  expect(backend.execute).toHaveBeenCalledTimes(2)
  run.resolve({ outcome: 'done' })
  await Promise.all([a, b])
})

test('closing all views does not abort execution; reopening sees the shared reply', async () => {
  const { repository, backend } = fixture()
  const done = deferred<{ outcome: 'done' }>()
  let signal!: AbortSignal
  let publish!: (messages: UIMessage[]) => void
  backend.execute = async (_id, _request, _messages, s, _event, next) => {
    signal = s
    publish = next
    return done.promise
  }
  const view = repository.subscribe('chat', () => {})
  await repository.read('chat')
  const run = repository.run('chat', { path: '/chat', body: {} }, [
    message('start'),
  ])
  view.dispose()
  expect(signal.aborted).toBe(false)
  publish([message('finished while closed')])
  await tick()
  expect((await repository.read('chat')).messages).toEqual([
    message('finished while closed'),
  ])
  done.resolve({ outcome: 'done' })
  await run
})

test('cache evicts only idle unobserved payloads and rehydrates hidden subscribers', async () => {
  const { repository, backend } = fixture({ maxBytes: 1, idleMs: 1 })
  const view = repository.subscribe('chat', () => {})
  await repository.read('chat')
  repository.sweep(Date.now() + 100)
  expect(repository.peek('chat').loaded).toBe(true)
  await repository.refresh('chat')
  view.visibility(false)
  repository.sweep(Date.now() + 100)
  expect(repository.peek('chat').loaded).toBe(false)
  backend.history = mock(async () => ({
    messages: [message('rehydrated')],
    hasMore: false,
  }))
  view.visibility(true)
  await tick()
  expect(repository.peek('chat').messages).toEqual([message('rehydrated')])
  view.dispose()
  repository.sweep(Date.now() + 100)
  expect(repository.inspect().entries).toBe(0)
})

test('history errors preserve the conversation and resident messages', async () => {
  const { repository, backend } = fixture()
  await repository.read('chat')
  backend.history = async () => {
    throw new Error('offline')
  }
  await expect(repository.refresh('chat', true)).rejects.toThrow('offline')
  expect(repository.peek('chat').messages).toEqual([message('history')])
  expect(repository.peek('chat').error).toContain('offline')
})

test('different turn IDs reconnect and stale stream callbacks cannot mutate the entry', async () => {
  const { repository, backend, streams } = fixture()
  backend.active = async () => turn('first')
  const view = repository.subscribe('chat', () => {})
  await tick()
  backend.active = async () => turn('second')
  await repository.refresh('chat')
  expect(streams).toHaveLength(2)
  expect(streams[0].signal.aborted).toBe(true)
  streams[0].event({ type: 'snapshot', messages: [message('stale')] }, 10)
  streams[1].event({ type: 'snapshot', messages: [message('current')] }, 1)
  await tick()
  expect(repository.peek('chat').messages).toEqual([message('current')])
  view.dispose()
})

test('many snapshots coalesce to one projection and publication per interval', async () => {
  const { repository, backend, streams } = fixture()
  backend.active = async () => turn()
  backend.project = mock((messages) => messages)
  const view = repository.subscribe('chat', () => {})
  await tick()
  const before = (backend.project as ReturnType<typeof mock>).mock.calls.length
  for (let i = 0; i < 1000; i++)
    streams[0].event({ type: 'snapshot', messages: [message(String(i))] }, i)
  await tick()
  expect(backend.project).toHaveBeenCalledTimes(before + 1)
  expect(repository.peek('chat').messages).toEqual([message('999')])
  view.dispose()
})

test('cancelling releases the execution owner before a replacement turn starts', async () => {
  const { repository, backend } = fixture()
  backend.execute = async (_id, _request, _messages, signal) => {
    await new Promise((resolve) =>
      signal.addEventListener('abort', resolve, { once: true }),
    )
    return { outcome: 'paused' }
  }
  const first = repository.run('chat', { path: '/chat', body: {} }, [])
  await repository.cancel('chat')
  await first
  backend.execute = async () => ({ outcome: 'done' })
  expect(
    (await repository.run('chat', { path: '/chat', body: {} }, [])).outcome,
  ).toBe('done')
})

test('hidden running followers can evict their transcript without losing turn metadata', async () => {
  const { repository, backend } = fixture({ maxBytes: 1, idleMs: 1 })
  backend.active = async () => turn()
  const view = repository.subscribe('chat', () => {})
  await tick()
  view.visibility(false)
  repository.sweep(Date.now() + 100)
  expect(repository.peek('chat').messages).toHaveLength(0)
  expect(repository.peek('chat').busy).toBe(true)
  expect(repository.inspect().bytes).toBe(0)
  view.dispose()
  backend.active = async () => null
  await repository.refresh('chat')
  repository.sweep(Date.now() + 100)
  expect(repository.inspect().entries).toBe(0)
})
