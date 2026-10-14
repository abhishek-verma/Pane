import { beforeEach, expect, mock, test } from 'bun:test'
import type { ComposerState } from '@/modules/chat/composer-store'
import { ChatRepository, type RepositoryBackend } from './repository'

mock.module('@/lib/execution-history/storage', () => ({
  upsertConversationExecutionTask: async () => {},
}))
mock.module('@/lib/llm-providers/storage', () => ({
  providersStorage: {
    getValue: async () => [
      { id: 'provider', type: 'openai', apiKey: 'current-secret' },
    ],
  },
}))
mock.module('@/lib/trust/trust-pins-storage', () => ({
  trustPinsStorage: { getValue: async () => ({}) },
  conversationTrustStorage: { getValue: async () => ({}) },
  requireBrowserInputApprovalStorage: { getValue: async () => true },
}))
const { startRepositoryQueue, durableChatRequest } = await import('./queue')
const { composerKey, readComposer, updateComposer } = await import(
  '@/modules/chat/composer-store'
)
let stored: Record<string, unknown> = {}
let listeners: Array<(changes: any, area: string) => void> = []
let locks = new Map<string, Promise<unknown>>()
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
beforeEach(() => {
  stored = {}
  listeners = []
  locks = new Map()
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (key: string, fn: () => unknown) => {
          const work = (locks.get(key) ?? Promise.resolve())
            .catch(() => {})
            .then(fn)
          locks.set(key, work)
          return work
        },
      },
    },
  })
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      tabs: { get: async () => ({ url: 'https://unchanged.invalid' }) },
      storage: {
        local: {
          get: async (keys: string | string[]) =>
            Object.fromEntries(
              (typeof keys === 'string' ? [keys] : keys)
                .filter((key) => key in stored)
                .map((key) => [key, structuredClone(stored[key])]),
            ),
          getKeys: async () => Object.keys(stored),
          remove: async (key: string) => {
            delete stored[key]
          },
          set: async (values: Record<string, unknown>) => {
            const changes = Object.fromEntries(
              Object.entries(values).map(([key, value]) => [
                key,
                { newValue: structuredClone(value) },
              ]),
            )
            Object.assign(stored, structuredClone(values))
            for (const listener of listeners) listener(changes, 'local')
          },
        },
        onChanged: { addListener: (fn: any) => listeners.push(fn) },
      },
    },
  })
})
function enqueue(id: string, ids = ['one', 'two']): ComposerState {
  const value: ComposerState = {
    draft: { text: '', tabs: [], attachments: [] },
    paused: false,
    queue: ids.map((id) => ({
      id,
      state: 'queued',
      message: { text: id },
      prepared: {
        path: '/chat',
        body: { providerId: 'provider', providerType: 'openai', message: id },
      },
    })),
  }
  stored[composerKey(id)] = value
  return value
}
function backend(): RepositoryBackend {
  return {
    active: async () => null,
    history: async () => ({ messages: [], hasMore: false }),
    attach: async (_id, _turn, _signal, event) => {
      event({ type: 'done', status: 'done' }, 10)
    },
    cancel: async () => true,
    project: (messages) => messages,
    execute: mock(async () => ({ outcome: 'done' as const })),
  }
}
test('durable requests exclude credentials and transcript copies', () => {
  expect(
    durableChatRequest({
      path: '/chat',
      body: {
        apiKey: 'secret',
        secretAccessKey: 'secret',
        sessionToken: 'secret',
        accessKeyId: 'secret',
        previousConversation: ['large'],
        message: 'keep',
      },
    }),
  ).toEqual({ path: '/chat', body: { message: 'keep' } })
})
test('one background dispatcher drains FIFO without any view and injects credentials only at execution', async () => {
  enqueue('chat')
  const service = backend(),
    repository = new ChatRepository(service),
    queue = startRepositoryQueue(repository)
  await Promise.all([queue.kick('chat'), queue.kick('chat')])
  await tick()
  await queue.kick('chat')
  const calls = (service.execute as ReturnType<typeof mock>).mock.calls
  expect(calls.map((call) => call[1].body.message)).toEqual(['one', 'two'])
  expect(calls[0][1].body.apiKey).toBe('current-secret')
  expect(calls[0][1].body.requireBrowserInputApproval).toBe(true)
  expect((await readComposer(composerKey('chat'))).queue).toHaveLength(0)
})
test('restart follows a persisted receipt and never resends an accepted message', async () => {
  const state = enqueue('chat', ['one'])
  state.queue[0].state = 'sending'
  state.queue[0].started = { conversationId: 'chat', turnId: 'existing' }
  const service = backend(),
    queue = startRepositoryQueue(new ChatRepository(service))
  await queue.kick('chat')
  expect(service.execute).not.toHaveBeenCalled()
  expect((await readComposer(composerKey('chat'))).queue).toHaveLength(0)
})
test('ambiguous deliveries require review after restart', async () => {
  const state = enqueue('chat', ['one'])
  state.queue[0].state = 'sending'
  const service = backend(),
    queue = startRepositoryQueue(new ChatRepository(service))
  await queue.kick('chat')
  const saved = await readComposer(composerKey('chat'))
  expect(saved.paused).toBe(true)
  expect(saved.queue[0].state).toBe('review')
  expect(service.execute).not.toHaveBeenCalled()
})
test('pending approvals block queued messages without dropping them', async () => {
  enqueue('chat', ['one'])
  const service = backend()
  service.history = async () => ({
    hasMore: false,
    messages: [
      {
        id: 'approval',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'write',
            toolCallId: 'call',
            state: 'approval-requested',
            input: {},
            approval: { id: 'approval' },
          },
        ],
      },
    ],
  })
  const queue = startRepositoryQueue(new ChatRepository(service))
  await queue.kick('chat')
  expect(service.execute).not.toHaveBeenCalled()
  expect((await readComposer(composerKey('chat'))).queue).toHaveLength(1)
})
test('a message edited before its claim is dispatched with the edited text', async () => {
  enqueue('chat', ['one'])
  await updateComposer(composerKey('chat'), (state) => ({
    ...state,
    queue: state.queue.map((item) => ({
      ...item,
      message: { ...item.message, text: 'edited' },
    })),
  }))
  const service = backend(),
    queue = startRepositoryQueue(new ChatRepository(service))
  await queue.kick('chat')
  expect(
    (service.execute as ReturnType<typeof mock>).mock.calls[0][1].body.message,
  ).toBe('edited')
})

const { submitRepositoryApproval, restoreApprovalDecisions } = await import(
  './approvals'
)
const approvalsMessage = () => ({
  id: 'assistant',
  role: 'assistant' as const,
  parts: ['a', 'b'].map((id) => ({
    type: 'dynamic-tool' as const,
    toolName: 'write',
    toolCallId: `call-${id}`,
    state: 'approval-requested' as const,
    input: { preview: 'small' },
    inputPreviewed: true,
    approval: { id },
  })),
})
const approvalRequest = {
  path: '/chat',
  body: {
    providerId: 'provider',
    providerType: 'openai',
    apiKey: 'must-not-persist',
  },
}

test('two views can answer different approvals and create exactly one durable resume', async () => {
  const service = backend()
  service.history = async () => ({
    messages: [approvalsMessage()],
    hasMore: false,
  })
  const repository = new ChatRepository(service)
  await Promise.all([
    submitRepositoryApproval(
      repository,
      'chat',
      { id: 'a', approved: true, input: { complete: 'reviewed' } },
      approvalRequest,
    ),
    submitRepositoryApproval(
      repository,
      'chat',
      { id: 'b', approved: false },
      approvalRequest,
    ),
  ])
  const saved = await readComposer(composerKey('chat'))
  expect(saved.queue).toHaveLength(1)
  expect(saved.queue[0].kind).toBe('approval')
  expect(saved.queue[0].prepared?.body.apiKey).toBeUndefined()
  expect(saved.queue[0].prepared?.body.toolApprovalResponses).toEqual([
    {
      approvalId: 'a',
      toolCallId: 'call-a',
      toolName: 'write',
      approved: true,
      input: { complete: 'reviewed' },
    },
    {
      approvalId: 'b',
      toolCallId: 'call-b',
      toolName: 'write',
      approved: false,
      input: undefined,
    },
  ])
  await submitRepositoryApproval(
    repository,
    'chat',
    { id: 'b', approved: false },
    approvalRequest,
  )
  expect((await readComposer(composerKey('chat'))).queue).toHaveLength(1)
  const queue = startRepositoryQueue(repository)
  await queue.kick('chat')
  expect(
    (service.execute as ReturnType<typeof mock>).mock.calls[0][1].body.message,
  ).toBe('')
  expect(
    (service.execute as ReturnType<typeof mock>).mock.calls[0][2],
  ).toHaveLength(1)
})

test('partial approval decisions survive restart and conflicting decisions do not overwrite them', async () => {
  const service = backend()
  service.history = async () => ({
    messages: [approvalsMessage()],
    hasMore: false,
  })
  const repository = new ChatRepository(service)
  await submitRepositoryApproval(
    repository,
    'chat',
    { id: 'a', approved: true },
    approvalRequest,
  )
  expect((await readComposer(composerKey('chat'))).queue).toHaveLength(0)
  const restored = await restoreApprovalDecisions('chat', [approvalsMessage()])
  expect((restored[0].parts[0] as any).state).toBe('approval-responded')
  await expect(
    submitRepositoryApproval(
      repository,
      'chat',
      { id: 'a', approved: false },
      approvalRequest,
    ),
  ).rejects.toThrow('already answered')
})

test('answering an approval does not unpause the remaining user queue', async () => {
  const state = enqueue('chat', ['later'])
  state.paused = true
  const service = backend()
  service.history = async () => ({
    messages: [approvalsMessage()],
    hasMore: false,
  })
  const repository = new ChatRepository(service)
  await submitRepositoryApproval(
    repository,
    'chat',
    { id: 'a', approved: true },
    approvalRequest,
  )
  await submitRepositoryApproval(
    repository,
    'chat',
    { id: 'b', approved: true },
    approvalRequest,
  )
  const queue = startRepositoryQueue(repository)
  await queue.kick('chat')
  const saved = await readComposer(composerKey('chat'))
  expect(saved.paused).toBe(true)
  expect(saved.queue.map((item) => item.message.text)).toEqual(['later'])
})

test('a paused queue still settles an accepted receipt without sending its next input', async () => {
  const state = enqueue('chat')
  state.paused = true
  state.queue[0].state = 'sending'
  state.queue[0].started = { conversationId: 'chat', turnId: 'stopped' }
  const service = backend()
  service.attach = async (_id, _turn, _signal, event) => {
    event({ type: 'done', status: 'cancelled' }, 1)
  }
  const queue = startRepositoryQueue(new ChatRepository(service))
  await queue.kick('chat')
  const saved = await readComposer(composerKey('chat'))
  expect(saved.paused).toBe(true)
  expect(saved.queue.map((item) => item.id)).toEqual(['two'])
  expect(service.execute).not.toHaveBeenCalled()
})

test('a queued provider switch cannot replace the lifecycle binding of a running turn', async () => {
  enqueue('chat', ['next'])
  const service = backend()
  service.configure = mock(async () => {})
  service.active = async () => ({
    conversationId: 'chat',
    turnId: 'running',
    status: 'running',
    startedAt: 1,
    lastSeq: 0,
    prompt: null,
    truncated: false,
  })
  const repository = new ChatRepository(service)
  const queue = startRepositoryQueue(repository)
  await queue.kick('chat')
  expect(service.configure).not.toHaveBeenCalled()
  expect(service.execute).not.toHaveBeenCalled()
})
