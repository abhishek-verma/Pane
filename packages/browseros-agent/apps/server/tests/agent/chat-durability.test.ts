import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import * as realAiSdkAgent from '../../src/agent/ai-sdk-agent'
import { SessionStore } from '../../src/agent/session-store'
import { closeDb, initializeDb } from '../../src/lib/db'

interface MockMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Array<Record<string, unknown>>
}

interface MockAgent {
  toolLoopAgent: object
  toolNames: Set<string>
  messages: MockMessage[]
  appendUserMessage(text: string): void
  dispose(): Promise<void>
}

interface StreamResponseOptions {
  uiMessages?: MockMessage[]
  onStepFinish?(args: { messages: MockMessage[] }): Promise<void>
  onFinish(args: {
    messages: MockMessage[]
    isAborted?: boolean
  }): Promise<void>
}

let agentToReturn: MockAgent | undefined
let streamResponseHandler:
  | ((options: StreamResponseOptions) => Promise<Response>)
  | undefined

const createAgentSpy = mock(async () => {
  if (!agentToReturn) throw new Error('No mock agent configured')
  return agentToReturn
})

const createDurableSpy = mock(async (options: StreamResponseOptions) => {
  if (!streamResponseHandler) {
    throw new Error('No stream response handler configured')
  }
  return await streamResponseHandler(options)
})

mock.module('../../src/agent/durable-agent-ui-stream', () => ({
  createDurableAgentUIStreamResponse: createDurableSpy,
}))

mock.module('../../src/agent/ai-sdk-agent', () => ({
  ...realAiSdkAgent,
  AiSdkAgent: { create: createAgentSpy },
}))

mock.module('../../src/lib/clients/llm/config', () => ({
  resolveLLMConfig: mock(async () => ({
    provider: 'openai',
    model: 'gpt-5',
    apiKey: 'test-key',
  })),
}))

mock.module('../../src/lib/logger', () => ({
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  },
}))

afterAll(() => {
  mock.restore()
  mock.module('../../src/agent/ai-sdk-agent', () => realAiSdkAgent)
})

const { ChatService } = await import('../../src/api/services/chat-service')

/**
 * The real AiSdkAgent backs `messages` with a single `_messages` field via a
 * getter/setter, and `appendUserMessage` pushes onto that same field — so
 * `session.agent.messages = <new array>` (chat-service.ts reassigns this
 * legitimately, e.g. via prepareMessagesForAgentTurn) and a later
 * `appendUserMessage` call always see the same state. Mirror that here with
 * a real getter/setter: a plain captured-closure array would let an external
 * `.messages = X` reassignment silently orphan the array appendUserMessage
 * pushes onto, so appended messages vanish from what chat-service reads next
 * (this previously broke `wrappedUserMessageId` lookups and crashed
 * `applyStreamMessages` on `messages.map` over an array that no longer had
 * the expected entries).
 */
function makeAgent(seed: MockMessage[] = []): MockAgent {
  let currentMessages = [...seed]
  return {
    toolLoopAgent: {},
    toolNames: new Set<string>(),
    get messages() {
      return currentMessages
    },
    set messages(next: MockMessage[]) {
      currentMessages = next
    },
    appendUserMessage(text: string) {
      const last = currentMessages[currentMessages.length - 1]
      if (last?.role === 'user') {
        const lastText = last.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n')
        if (lastText === text) return
      }
      currentMessages.push({
        id: `u-${currentMessages.length + 1}`,
        role: 'user',
        parts: [{ type: 'text', text }],
      })
    },
    async dispose() {},
  }
}

describe('Chat durability checkpoints', () => {
  let tmpDir: string
  let store: SessionStore
  let service: ChatService

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browseros-durability-'))
    initializeDb({ dbPath: join(tmpDir, 'test.db'), runMigrations: true })
    store = new SessionStore()
    service = new ChatService({
      sessionStore: store,
      browser: {
        newPage: mock(async () => 0),
        listPages: mock(async () => []),
        closePage: mock(async () => {}),
        createWindow: mock(async () => ({ windowId: 0 })),
        closeWindow: mock(async () => {}),
        resolveTabIds: mock(async () => new Map<number, number>()),
      } as never,
      browserSession: {} as never,
      serverPort: 9100,
    })
    agentToReturn = undefined
    streamResponseHandler = undefined
    createDurableSpy.mockClear()
    createAgentSpy.mockClear()
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists the user message when the stream never finishes', async () => {
    const conversationId = crypto.randomUUID()
    agentToReturn = makeAgent()

    streamResponseHandler = async () => {
      // Never call onFinish — simulates crash / hung stream.
      return new Response('ok')
    }

    await service.processMessage(
      {
        conversationId,
        message: 'remember this prompt',
        browserContext: { pages: [], activePageId: 0 },
      } as never,
      new AbortController().signal,
    )

    const loaded = await store.loadMessages(conversationId)
    expect(loaded.some((m) => m.role === 'user')).toBe(true)
    const userText = JSON.stringify(loaded.find((m) => m.role === 'user'))
    expect(userText).toContain('remember this prompt')
  })

  it('persists approval-patched state before resume stream', async () => {
    const conversationId = crypto.randomUUID()
    const prior: MockMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'do something risky' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-1',
            state: 'approval-requested',
            approval: { id: 'apr-1' },
            input: { path: 'x.txt', content: 'hi' },
          },
        ],
      },
    ]
    await store.persistMessages(conversationId, prior as UIMessage[])
    agentToReturn = makeAgent(structuredClone(prior))
    // Hydrate sanitizes tool parts against the current toolset (Task 2);
    // an empty toolset would strip the pending `tool-filesystem_write` part
    // before the approval resume below ever sees it.
    agentToReturn.toolNames = new Set(['filesystem_write'])

    let sawCheckpointBeforeFinish = false
    streamResponseHandler = async ({ onFinish }) => {
      const mid = await store.loadMessages(conversationId)
      const content = JSON.stringify(mid)
      sawCheckpointBeforeFinish = content.includes('approval-responded')
      await onFinish({
        messages: [
          prior[0]!,
          {
            ...prior[1]!,
            parts: [
              {
                ...prior[1]?.parts[0],
                state: 'output-available',
                output: [{ type: 'text', text: 'done' }],
              },
            ],
          },
        ],
      })
      return new Response('ok')
    }

    await service.processMessage(
      {
        conversationId,
        message: '',
        browserContext: { pages: [], activePageId: 0 },
        toolApprovalResponses: [{ approvalId: 'apr-1', approved: true }],
      } as never,
      new AbortController().signal,
    )

    expect(sawCheckpointBeforeFinish).toBe(true)
  })

  it('awaits finish persist with partial assistant on abort', async () => {
    const conversationId = crypto.randomUUID()
    agentToReturn = makeAgent()

    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      const user = uiMessages?.[0] ?? {
        id: 'u',
        role: 'user' as const,
        parts: [{ type: 'text', text: 'partial turn' }],
      }
      await onFinish({
        messages: [
          user,
          {
            id: 'a-partial',
            role: 'assistant',
            parts: [{ type: 'text', text: 'I got this far' }],
          },
        ],
        isAborted: true,
      })
      return new Response('ok')
    }

    const ac = new AbortController()
    ac.abort()
    await service.processMessage(
      {
        conversationId,
        message: 'partial turn',
        browserContext: { pages: [], activePageId: 0 },
      } as never,
      ac.signal,
    )

    const loaded = await store.loadMessages(conversationId)
    expect(loaded).toHaveLength(2)
    expect(JSON.stringify(loaded[1])).toContain('I got this far')
  })

  it('checkpoints on step finish during multi-tool turns', async () => {
    const conversationId = crypto.randomUUID()
    agentToReturn = makeAgent()
    let stepPersists = 0

    streamResponseHandler = async ({ onStepFinish, onFinish, uiMessages }) => {
      const user = uiMessages![0]!
      const step1 = [
        user,
        {
          id: 'a1',
          role: 'assistant' as const,
          parts: [
            {
              type: 'tool-tabs',
              toolCallId: 't1',
              state: 'output-available',
              input: { action: 'list' },
              output: [{ type: 'text', text: 'ok' }],
            },
          ],
        },
      ]
      await onStepFinish?.({ messages: step1 })
      stepPersists = (await store.loadMessages(conversationId)).length

      const step2 = [
        ...step1,
        // same assistant continuation with more parts is modeled as one msg
      ]
      step2[1] = {
        id: 'a1',
        role: 'assistant',
        parts: [
          ...(step1[1]?.parts as Array<Record<string, unknown>>),
          {
            type: 'text',
            text: 'done with tools',
          },
        ],
      }
      await onFinish({ messages: step2, isAborted: false })
      return new Response('ok')
    }

    await service.processMessage(
      {
        conversationId,
        message: 'use tools',
        browserContext: { pages: [], activePageId: 0 },
      } as never,
      new AbortController().signal,
    )

    expect(stepPersists).toBeGreaterThanOrEqual(2)
    const final = await store.loadMessages(conversationId)
    expect(JSON.stringify(final)).toContain('done with tools')
  })
})

describe('SessionStore persist hardening', () => {
  let tmpDir: string
  let store: SessionStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browseros-persist-'))
    initializeDb({ dbPath: join(tmpDir, 'test.db'), runMigrations: true })
    store = new SessionStore()
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('serializes concurrent persists without wiping messages', async () => {
    const id = 'concurrent-session'
    const a: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'A' }] },
    ]
    const b: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'A' }] },
      { id: '2', role: 'assistant', parts: [{ type: 'text', text: 'B' }] },
    ]

    await Promise.all([
      store.persistMessages(id, a, { syncIndexes: false }),
      store.persistMessages(id, b, { syncIndexes: false }),
    ])

    const loaded = await store.loadMessages(id)
    expect(loaded.length).toBeGreaterThanOrEqual(1)
    expect(loaded.some((m) => m.role === 'user')).toBe(true)
  })

  it('does not resurrect a deleted session on late persist', async () => {
    const id = 'deleted-session'
    await store.persistMessages(id, [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'bye' }] },
    ])
    await store.delete(id)

    await store.persistMessages(id, [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'zombie' }] },
    ])

    expect(await store.hasPersistedSession(id)).toBe(false)
    expect(await store.loadMessages(id)).toHaveLength(0)
  })

  it('skips index sync when syncIndexes is false', async () => {
    const id = 'no-index'
    await store.persistMessages(
      id,
      [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      { syncIndexes: false },
    )
    const loaded = await store.loadMessages(id)
    expect(loaded).toHaveLength(1)
  })
})
