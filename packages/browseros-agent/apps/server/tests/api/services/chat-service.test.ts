import { afterAll, describe, expect, it, mock } from 'bun:test'
import * as realAi from 'ai'
import * as realAiSdkAgent from '../../../src/agent/ai-sdk-agent'

interface MockMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Array<{ type: 'text'; text: string }>
}

interface MockAgent {
  toolLoopAgent: object
  toolNames: Set<string>
  messages: MockMessage[]
  appendUserMessage(text: string): void
  dispose(): Promise<void>
}

interface StoredSession {
  agent: MockAgent
  hiddenPageId?: number
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

const createAgentSpy = mock(async (config: unknown) => {
  if (!agentToReturn) {
    throw new Error(`No mock agent configured for ${JSON.stringify(config)}`)
  }
  return agentToReturn
})

const createDurableAgentUIStreamResponseSpy = mock(
  async (options: StreamResponseOptions) => {
    if (!streamResponseHandler) {
      throw new Error('No stream response handler configured')
    }
    return await streamResponseHandler(options)
  },
)

const resolveLLMConfigSpy = mock(async () => ({
  provider: 'openai',
  model: 'gpt-5',
  apiKey: 'test-key',
}))

mock.module('../../../src/agent/durable-agent-ui-stream', () => ({
  createDurableAgentUIStreamResponse: createDurableAgentUIStreamResponseSpy,
}))

mock.module('../../../src/agent/ai-sdk-agent', () => ({
  ...realAiSdkAgent,
  AiSdkAgent: {
    create: createAgentSpy,
  },
}))

mock.module('../../../src/lib/clients/llm/config', () => ({
  resolveLLMConfig: resolveLLMConfigSpy,
}))

mock.module('../../../src/lib/logger', () => ({
  logger: {
    info: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
  },
}))

afterAll(() => {
  mock.restore()
  // mock.restore() does not always clear mock.module; re-bind real modules so
  // later suites are not poisoned by incomplete named-export mocks.
  mock.module('ai', () => realAi)
  mock.module('../../../src/agent/ai-sdk-agent', () => realAiSdkAgent)
})

const { ChatService } = await import('../../../src/api/services/chat-service')

function createSessionStore(
  overrides: {
    loadMessages?: (
      conversationId: string,
    ) => Promise<StoredSession['agent']['messages']>
    persistMessages?: (
      conversationId: string,
      messages: StoredSession['agent']['messages'],
      options?: { syncIndexes: boolean },
    ) => Promise<void>
  } = {},
) {
  const sessions = new Map<string, StoredSession>()
  return {
    get(conversationId: string) {
      return sessions.get(conversationId)
    },
    set(conversationId: string, session: StoredSession) {
      sessions.set(conversationId, session)
    },
    remove(conversationId: string) {
      return sessions.delete(conversationId)
    },
    async loadMessages(conversationId: string) {
      if (overrides.loadMessages) return overrides.loadMessages(conversationId)
      return [] as StoredSession['agent']['messages']
    },
    async persistMessages(
      conversationId: string,
      messages: StoredSession['agent']['messages'],
      options?: { syncIndexes: boolean },
    ) {
      await overrides.persistMessages?.(conversationId, messages, options)
    },
    async delete(conversationId: string) {
      const session = sessions.get(conversationId)
      if (!session) return false
      await session.agent.dispose()
      sessions.delete(conversationId)
      return true
    },
    async hasPersistedSession(_conversationId: string) {
      return false
    },
    count() {
      return sessions.size
    },
    imageStore: {
      store: () => true,
      get: () => null,
      deleteForSession: () => {},
    },
    outputStore: {
      store: () => true,
      get: () => null,
      deleteForSession: () => {},
    },
  }
}

function createChatServiceDeps(
  overrides: {
    sessionStore?: ReturnType<typeof createSessionStore>
    browser?: Record<string, unknown>
    browserSession?: Record<string, unknown>
    serverPort?: number
  } = {},
) {
  return {
    sessionStore: (overrides.sessionStore ?? createSessionStore()) as never,
    browser: (overrides.browser ?? {
      newPage: mock(async () => 0),
      listPages: mock(async () => []),
      closePage: mock(async () => {}),
      createWindow: mock(async () => ({ windowId: 0 })),
      closeWindow: mock(async () => {}),
      resolveTabIds: mock(async () => new Map<number, number>()),
    }) as never,
    browserSession: (overrides.browserSession ?? {}) as never,
    serverPort: overrides.serverPort ?? 9100,
  }
}

function createFakeAgent() {
  const messages: MockMessage[] = []
  return {
    toolLoopAgent: {},
    toolNames: new Set<string>(),
    messages,
    appendUserMessage(text: string) {
      // Mirror production: skip when the last user already has this raw text
      // (previousConversation inject + append race).
      const last = this.messages[this.messages.length - 1]
      if (last?.role === 'user') {
        const lastText = last.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join('\n')
        if (lastText === text) return
      }
      // Mirror production's id-per-call: a hardcoded constant would
      // collide on repeat calls in the same agent instance and corrupt
      // the id-diff logic the ACP onFinish branch relies on.
      this.messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text }],
      })
    },
    dispose: mock(async () => {}),
  }
}

describe('ChatService scheduled task hidden page lifecycle', () => {
  it('creates and cleans up a hidden page without creating a hidden window', async () => {
    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? fakeAgent.messages })
      return new Response('ok')
    }

    const browser = {
      newPage: mock(async () => 77),
      listPages: mock(async () => [
        {
          pageId: 77,
          windowId: 11,
        },
      ]),
      closePage: mock(async () => {}),
      createWindow: mock(async () => ({ windowId: 11 })),
      closeWindow: mock(async () => {}),
      resolveTabIds: mock(async () => new Map<number, number>()),
    }
    const sessionStore = createSessionStore()
    const service = new ChatService(
      createChatServiceDeps({ sessionStore, browser }),
    )

    await service.processMessage(
      {
        conversationId: crypto.randomUUID(),
        message: 'Run the scheduled task',
        isScheduledTask: true,
        mode: 'agent',
        origin: 'sidepanel',
        browserContext: {
          windowId: 9,
          activeTab: {
            id: 3,
            url: 'https://example.com',
            title: 'Example',
          },
          selectedTabs: [{ id: 4 }],
          enabledMcpServers: ['slack'],
        },
      } as never,
      new AbortController().signal,
    )

    expect(browser.newPage).toHaveBeenCalledWith('about:blank', {
      hidden: true,
      background: true,
    })
    expect(browser.createWindow).not.toHaveBeenCalled()
    expect(browser.closePage).toHaveBeenCalledWith(77)
    expect(browser.closeWindow).not.toHaveBeenCalled()

    const createArgs = createAgentSpy.mock.calls.at(-1)?.[0] as {
      browserContext?: {
        windowId?: number
        selectedTabs?: unknown[]
        activeTab?: {
          id: number
          pageId: number
          url: string
          title: string
        }
        enabledMcpServers?: string[]
      }
    }
    expect(createArgs.browserContext?.windowId).toBe(11)
    expect(createArgs.browserContext?.selectedTabs).toBeUndefined()
    expect(createArgs.browserContext?.activeTab).toEqual({
      id: 77,
      pageId: 77,
      url: 'about:blank',
      title: 'Scheduled Task',
    })
    expect(createArgs.browserContext?.enabledMcpServers).toEqual(['slack'])
  })

  it('deleteSession closes the tracked hidden page', async () => {
    const fakeAgent = createFakeAgent()
    const sessionStore = createSessionStore()
    const browser = {
      closePage: mock(async () => {}),
    }
    const conversationId = crypto.randomUUID()

    sessionStore.set(conversationId, {
      agent: fakeAgent,
      hiddenPageId: 33,
    })

    const service = new ChatService(
      createChatServiceDeps({ sessionStore, browser }),
    )

    const result = await service.deleteSession(conversationId)

    expect(result).toEqual({ deleted: true, sessionCount: 0 })
    expect(browser.closePage).toHaveBeenCalledWith(33)
    expect(fakeAgent.dispose).toHaveBeenCalledTimes(1)
  })

  it('keeps the scheduled hidden page context when metadata lookup fails', async () => {
    const fakeAgent = createFakeAgent()
    agentToReturn = fakeAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? fakeAgent.messages })
      return new Response('ok')
    }

    const browser = {
      newPage: mock(async () => 88),
      listPages: mock(async () => {
        throw new Error('CDP lookup failed')
      }),
      closePage: mock(async () => {}),
      resolveTabIds: mock(async () => new Map<number, number>()),
    }
    const sessionStore = createSessionStore()
    const service = new ChatService(
      createChatServiceDeps({ sessionStore, browser }),
    )

    await service.processMessage(
      {
        conversationId: crypto.randomUUID(),
        message: 'Run the scheduled task',
        isScheduledTask: true,
        mode: 'agent',
        origin: 'sidepanel',
        browserContext: {
          activeTab: {
            id: 3,
            url: 'https://example.com',
            title: 'Example',
          },
        },
      } as never,
      new AbortController().signal,
    )

    const createArgs = createAgentSpy.mock.calls.at(-1)?.[0] as {
      browserContext?: {
        windowId?: number
        activeTab?: {
          id: number
          pageId: number
          url: string
          title: string
        }
      }
    }
    expect(createArgs.browserContext?.windowId).toBeUndefined()
    expect(createArgs.browserContext?.activeTab).toEqual({
      id: 88,
      pageId: 88,
      url: 'about:blank',
      title: 'Scheduled Task',
    })
    expect(browser.closePage).toHaveBeenCalledWith(88)
  })
})

describe('ChatService browser tool config', () => {
  it('passes browser session into new and rebuilt agent sessions', async () => {
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()
    agentToReturn = firstAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    const browser = {
      resolveTabIds: mock(
        async (tabIds: number[]) =>
          new Map(tabIds.map((tabId) => [tabId, tabId + 100])),
      ),
      closePage: mock(async () => {}),
    }
    const service = new ChatService(
      createChatServiceDeps({
        browser,
        browserSession: { pages: {} },
      }),
    )
    const createCallsBefore = createAgentSpy.mock.calls.length
    const request = {
      conversationId: crypto.randomUUID(),
      message: 'check integrations',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
      browserContext: {
        activeTab: {
          id: 3,
          url: 'https://example.com',
          title: 'Example',
        },
        enabledMcpServers: ['slack'],
      },
    } as never

    await service.processMessage(request, new AbortController().signal)

    agentToReturn = secondAgent

    await service.processMessage(
      {
        ...request,
        message: 'check integrations again',
        browserContext: {
          ...request.browserContext,
          enabledMcpServers: ['slack', 'github'],
        },
      },
      new AbortController().signal,
    )

    const createCalls = createAgentSpy.mock.calls.slice(createCallsBefore)
    expect(createCalls).toHaveLength(2)
    for (const [config] of createCalls) {
      expect(config).toMatchObject({ browserSession: { pages: {} } })
    }
  })
})
describe('ChatService ACP provider chat history handling', () => {
  // ACP-backed providers (claude-code, codex, acp-custom) run against
  // a persistent acpx session that owns the agent's conversation
  // memory on disk. Re-feeding the full UIMessage history would double
  // bookkeeping and trip the AI SDK validator when it walks phantom
  // tool-<name> parts emitted by acpx-ai-provider under freshly-
  // generated "acpx-N" ids (acpx#37). The chat-service therefore sends
  // only the new user message on ACP turns; acpx loads prior turns
  // from disk transparently. These tests pin that branch.

  function withAcpProvider() {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'claude-code',
      model: 'opus',
      apiKey: 'unused',
    }))
  }

  function withLlmProvider() {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  }

  function baseDeps() {
    const browser = {
      newPage: mock(async () => 0),
      listPages: mock(async () => []),
      closePage: mock(async () => {}),
      createWindow: mock(async () => ({ windowId: 0 })),
      closeWindow: mock(async () => {}),
      resolveTabIds: mock(async () => new Map<number, number>()),
    }
    return {
      browser,
      sessionStore: createSessionStore(),
    }
  }

  function chatRequest(overrides: Record<string, unknown> = {}) {
    return {
      conversationId: crypto.randomUUID(),
      message: 'hello',
      isScheduledTask: false,
      mode: 'agent',
      origin: 'sidepanel',
      browserContext: {
        activeTab: { id: 1, url: 'https://example.com', title: 'Example' },
      },
      ...overrides,
    } as never
  }

  it('passes only the new user message to streamText for ACP providers', async () => {
    withAcpProvider()
    const agent = createFakeAgent()
    agentToReturn = agent
    let captured: MockMessage[] | undefined
    streamResponseHandler = async ({ uiMessages, onFinish }) => {
      captured = uiMessages
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }
    const deps = baseDeps()
    const service = new ChatService(createChatServiceDeps(deps))

    await service.processMessage(
      chatRequest({
        browserContext: {
          activeTab: { id: 1, url: 'https://example.com', title: 'Example' },
          enabledMcpServers: ['Slack', 'Google Docs'],
        },
      }),
      new AbortController().signal,
    )

    expect(captured).toHaveLength(1)
    expect(captured?.[0]?.role).toBe('user')
    expect(captured?.[0]?.parts[0]?.type).toBe('text')
    const createArgs = createAgentSpy.mock.calls.at(-1)?.[0] as {
      resolvedConfig?: {
        acpMcpServers?: Array<{
          type: 'http'
          headers: Array<{ name: string; value: string }>
        }>
      }
    }
    expect(
      createArgs.resolvedConfig?.acpMcpServers?.[0]?.headers.find(
        (h) => h.name === 'X-BrowserOS-Managed-Mcp-Servers',
      )?.value,
    ).toBe('Slack,Google%20Docs')
  })

  it('still passes the full filtered history for LLM-API providers', async () => {
    withLlmProvider()
    const agent = createFakeAgent()
    // Seed prior turns.
    agent.messages.push(
      { id: 'u-0', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      {
        id: 'a-0',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    )
    agentToReturn = agent
    let captured: MockMessage[] | undefined
    streamResponseHandler = async ({ uiMessages, onFinish }) => {
      captured = uiMessages
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }
    const deps = baseDeps()
    const service = new ChatService(createChatServiceDeps(deps))

    await service.processMessage(chatRequest(), new AbortController().signal)

    expect(captured?.length).toBeGreaterThan(1)
    expect(captured?.map((m) => m.role)).toContain('assistant')
  })

  it('does not re-feed phantom acpx-N tool parts to streamText on a follow-up ACP turn', async () => {
    withAcpProvider()
    const agent = createFakeAgent()
    // Simulate a prior turn where acpx-ai-provider's translator left
    // a phantom tool part behind in session.agent.messages.
    agent.messages.push(
      {
        id: 'u-prior',
        role: 'user',
        parts: [{ type: 'text', text: 'list files' }],
      },
      {
        id: 'a-prior',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'I will list them.' },
          // The phantom shape we worry about: tool part with the
          // acpx-N toolCallId and no input. With the old code this
          // would re-enter streamText on the next turn and trip
          // the AI SDK validator with the 500 the user reported.
          // The new code never includes this in promptUiMessages.
          {
            type: 'tool-mcp.browseros.grep',
            toolCallId: 'acpx-3',
            state: 'input-streaming',
            input: undefined,
          } as never,
        ],
      },
    )
    agentToReturn = agent
    let captured: MockMessage[] | undefined
    streamResponseHandler = async ({ uiMessages, onFinish }) => {
      captured = uiMessages
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }
    const deps = baseDeps()
    const service = new ChatService(createChatServiceDeps(deps))

    await service.processMessage(
      chatRequest({ message: 'what about gaming' }),
      new AbortController().signal,
    )

    // Crucial: the phantom part never reaches streamText.
    const allParts = (captured ?? []).flatMap((m) => m.parts)
    expect(
      allParts.some((p) => (p as { type?: string }).type?.startsWith('tool-')),
    ).toBe(false)
    expect(captured?.length).toBe(1)
  })

  it('preserves UI display state by appending the assistant reply to session.agent.messages on an ACP turn', async () => {
    withAcpProvider()
    const agent = createFakeAgent()
    agent.messages.push(
      {
        id: 'u-prior',
        role: 'user',
        parts: [{ type: 'text', text: 'list files' }],
      },
      {
        id: 'a-prior',
        role: 'assistant',
        parts: [{ type: 'text', text: 'one, two, three.' }],
      },
    )
    agentToReturn = agent
    streamResponseHandler = async ({ uiMessages, onFinish }) => {
      // Simulate the AI SDK reducer yielding the single user msg we
      // sent + a fresh assistant reply.
      const assistantMsg = {
        id: 'a-new',
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'foo, bar, baz.' }],
      }
      await onFinish({ messages: [...(uiMessages ?? []), assistantMsg] })
      return new Response('ok')
    }
    const deps = baseDeps()
    const service = new ChatService(createChatServiceDeps(deps))

    await service.processMessage(
      chatRequest({ message: 'now read foo.md' }),
      new AbortController().signal,
    )

    // Prior turns survive, the new user msg has raw text, the
    // assistant reply is appended at the end.
    expect(agent.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ])
    expect(agent.messages.at(-1)?.parts[0]?.text).toBe('foo, bar, baz.')
    expect(agent.messages.at(-2)?.parts[0]?.text).toBe('now read foo.md')
  })
})

describe('ChatService tool approval resume', () => {
  it('patches approval-requested parts and resumes without appending a user message', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agent.toolNames = new Set(['filesystem_write'])
    agent.messages.push(
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'write hello.txt' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'hello.txt', content: 'hi' },
            approval: { id: 'approval-1' },
          } as never,
        ],
      },
    )

    let patchedAtStreamStart: {
      state?: string
      input?: Record<string, unknown>
      approval?: { approved?: boolean }
    } | null = null
    let capturedUiMessages: MockMessage[] | undefined
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      // Capture patch state before onFinish may rewrite session messages.
      patchedAtStreamStart = (agent.messages[1]?.parts[0] ?? null) as never
      capturedUiMessages = uiMessages
      await onFinish({
        messages: (uiMessages ?? agent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: '',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
        toolApprovalResponses: [
          {
            approvalId: 'approval-1',
            toolCallId: 'call-1',
            toolName: 'filesystem_write',
            approved: true,
            input: { path: 'hello.txt', content: 'edited' },
          },
        ],
      } as never,
      new AbortController().signal,
    )

    expect(patchedAtStreamStart?.state).toBe('approval-responded')
    expect(patchedAtStreamStart?.approval?.approved).toBe(true)
    expect(patchedAtStreamStart?.input).toEqual({
      path: 'hello.txt',
      content: 'edited',
    })
    // No new user message appended on approval resume.
    expect(agent.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(capturedUiMessages?.map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ])
    const streamedTool = capturedUiMessages?.[1]?.parts[0] as unknown as {
      state?: string
    }
    expect(streamedTool.state).toBe('approval-responded')
  })

  it('auto-denies pending approvals when a new user message arrives', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agent.toolNames = new Set(['evaluate'])
    agent.messages.push(
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'run title' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { expression: 'document.title' },
            approval: { id: 'approval-1' },
          } as never,
        ],
      },
    )

    let settledAtStreamStart: {
      state?: string
      approval?: { approved?: boolean }
    } | null = null
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      settledAtStreamStart = (agent.messages[1]?.parts[0] ?? null) as never
      await onFinish({
        messages: (uiMessages ?? agent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'never mind, do something else',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )

    expect(settledAtStreamStart?.state).toBe('output-denied')
    expect(settledAtStreamStart?.approval?.approved).toBe(false)
    expect(agent.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ])
    expect(agent.messages.at(-1)?.parts[0]?.text).toBe(
      'never mind, do something else',
    )
  })
})

describe('ChatService message repair on hydrate and new turns', () => {
  it('repairs legacy/incomplete tool states from a persisted transcript before the next turn', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agent.toolNames = new Set(['evaluate', 'act'])
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({
        messages: (uiMessages ?? agent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    // A prior server crash left an input-available tool call mid-flight and
    // a legacy state:'result' part from an older AI SDK version. Both must
    // be repaired before validateUIMessages ever sees this transcript again.
    const persisted: MockMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'run stuff' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-legacy',
            state: 'result',
            input: { expression: '1' },
            output: { ok: true },
          } as never,
          {
            type: 'tool-act',
            toolCallId: 'call-stuck',
            state: 'input-available',
            input: { kind: 'click' },
          } as never,
        ],
      },
    ]

    let persistedAtCheckpoint: unknown[] | undefined
    const sessionStore = createSessionStore({
      loadMessages: async () => persisted,
      persistMessages: async (_id, messages) => {
        persistedAtCheckpoint = messages
      },
    })

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'continue',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )

    const assistantParts = persistedAtCheckpoint?.find(
      (m) => (m as MockMessage).id === 'asst-1',
    )?.parts as Array<{ state?: string }> | undefined
    expect(assistantParts?.[0]?.state).toBe('output-available')
    expect(assistantParts?.[1]?.state).toBe('output-error')
  })

  it('does not settle the just-applied approval-responded parts during an approval resume', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agent.toolNames = new Set(['filesystem_write'])
    agent.messages.push(
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'write' }] },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'a.txt', content: 'hi' },
            approval: { id: 'approval-1' },
          } as never,
        ],
      },
    )

    let stateAtStreamStart: string | undefined
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      stateAtStreamStart = (
        agent.messages[1]?.parts[0] as { state?: string } | undefined
      )?.state
      await onFinish({
        messages: (uiMessages ?? agent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: '',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
        toolApprovalResponses: [
          {
            approvalId: 'approval-1',
            toolCallId: 'call-1',
            toolName: 'filesystem_write',
            approved: true,
          },
        ],
      } as never,
      new AbortController().signal,
    )

    // Must stay approval-responded — settleUnresolvedToolApprovals would
    // otherwise deny the approval the user just granted.
    expect(stateAtStreamStart).toBe('approval-responded')
  })

  it('applies the resume decision on the very first request after a server restart', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    // No in-memory session yet (server just restarted) — only a durable
    // transcript with a still-pending approval. The first request for this
    // conversation is itself the approval resume: hydrate must not auto-deny
    // the pending part before applyToolApprovalDecisions gets to it.
    const conversationId = crypto.randomUUID()
    const persisted: MockMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'write hello.txt' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'hello.txt', content: 'hi' },
            approval: { id: 'approval-1' },
          } as never,
        ],
      },
    ]

    const agent = createFakeAgent()
    agent.toolNames = new Set(['filesystem_write'])
    agentToReturn = agent
    let stateAtStreamStart: string | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      stateAtStreamStart = (
        agent.messages[1]?.parts[0] as { state?: string } | undefined
      )?.state
      await onFinish({
        messages: (uiMessages ?? agent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const sessionStore = createSessionStore({
      loadMessages: async () => persisted,
    })
    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: '',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
        toolApprovalResponses: [
          {
            approvalId: 'approval-1',
            toolCallId: 'call-1',
            toolName: 'filesystem_write',
            approved: true,
          },
        ],
      } as never,
      new AbortController().signal,
    )

    expect(stateAtStreamStart).toBe('approval-responded')
  })
})

describe('ChatService conversation mutex', () => {
  it('supersedes an in-flight turn when a new user message arrives', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agent.toolNames = new Set(['evaluate'])
    agentToReturn = agent

    const captured: Array<{
      onFinish: (args: {
        messages: MockMessage[]
        isAborted?: boolean
      }) => Promise<void>
      uiMessages: MockMessage[]
    }> = []
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      captured.push({ onFinish, uiMessages: uiMessages ?? agent.messages })
      return new Response('ok')
    }

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)
    const service = new ChatService(createChatServiceDeps({ sessionStore }))

    const requestA = {
      conversationId,
      message: 'first message',
      mode: 'agent',
      origin: 'sidepanel',
      isScheduledTask: false,
    } as never
    const requestB = {
      conversationId,
      message: 'second message',
      mode: 'agent',
      origin: 'sidepanel',
      isScheduledTask: false,
    } as never

    await service.processMessage(requestA, new AbortController().signal)
    expect(captured).toHaveLength(1)
    expect(await service.getActiveTurn(conversationId)).not.toBeNull()

    // New user prompt cancels A (unlocks) then starts B — does not queue forever.
    await service.processMessage(requestB, new AbortController().signal)
    expect(captured).toHaveLength(2)
    expect(
      agent.messages.some((m) => m.parts[0]?.text === 'second message'),
    ).toBe(true)

    await captured[1]?.onFinish({ messages: captured[1]?.uiMessages ?? [] })
    expect(await service.getActiveTurn(conversationId)).toBeNull()
  })

  it('releases the lock on a synchronous failure so the conversation is not wedged', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => {
      throw new Error('boom')
    })

    const conversationId = crypto.randomUUID()
    const service = new ChatService(createChatServiceDeps())

    await expect(
      service.processMessage(
        {
          conversationId,
          message: 'hello',
          mode: 'agent',
          origin: 'sidepanel',
          isScheduledTask: false,
        } as never,
        new AbortController().signal,
      ),
    ).rejects.toThrow('boom')

    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
    const agent = createFakeAgent()
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? agent.messages })
      return new Response('ok')
    }

    // Must not hang — the failed first call must have released the lock.
    await service.processMessage(
      {
        conversationId,
        message: 'hello again',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )
  })

  it('does not release the lock on client abort alone; cancelTurn does', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agentToReturn = agent

    const captured: Array<{
      onFinish: (args: {
        messages: MockMessage[]
        isAborted?: boolean
      }) => Promise<void>
      abortSignal?: AbortSignal
    }> = []
    streamResponseHandler = async ({ onFinish, abortSignal }) => {
      captured.push({ onFinish, abortSignal })
      // Simulate a cancelled response body: Response returns, onFinish never
      // runs until we explicitly settle — HTTP abort alone must not unlock.
      return new Response('ok')
    }

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)
    const service = new ChatService(createChatServiceDeps({ sessionStore }))

    const abortA = new AbortController()
    await service.processMessage(
      {
        conversationId,
        message: 'first',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      abortA.signal,
    )
    expect(captured).toHaveLength(1)
    expect(await service.getActiveTurn(conversationId)).not.toBeNull()

    // Detach only — turn stays active, lock stays held.
    abortA.abort()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await service.getActiveTurn(conversationId)).not.toBeNull()

    // Explicit cancel unlocks so a superseding message can proceed.
    expect(service.cancelTurn(conversationId, 'user-stop')).toBe(true)
    expect(await service.getActiveTurn(conversationId)).toBeNull()

    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      captured.push({ onFinish })
      await onFinish({ messages: uiMessages ?? agent.messages })
      return new Response('ok')
    }

    await service.processMessage(
      {
        conversationId,
        message: 'retry after stop',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )
    expect(captured.length).toBeGreaterThanOrEqual(2)
    expect(
      agent.messages.some((m) => m.parts[0]?.text === 'retry after stop'),
    ).toBe(true)
  })

  it('attachTurn delivers a snapshot while the turn is still running after detach', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agentToReturn = agent
    let stepFinish:
      | ((args: { messages: MockMessage[] }) => Promise<void>)
      | undefined
    streamResponseHandler = async ({ onStepFinish, onFinish }) => {
      stepFinish = onStepFinish
      void onFinish
      return new Response('partial')
    }

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)
    const service = new ChatService(createChatServiceDeps({ sessionStore }))

    const abortA = new AbortController()
    await service.processMessage(
      {
        conversationId,
        message: 'research',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      abortA.signal,
    )
    abortA.abort()

    await stepFinish?.({
      messages: [
        {
          id: 'u1',
          role: 'user',
          parts: [{ type: 'text', text: 'research' }],
        },
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'still working' }],
        },
      ],
    })

    const attach = service.attachTurn({ conversationId })
    expect(attach).not.toBeNull()
    expect(attach?.headers.get('X-Turn-Id')).toBeTruthy()

    expect(service.cancelTurn(conversationId, 'test-cleanup')).toBe(true)
  })

  it('scheduled fetch abort cancels the turn via unified cancel', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agentToReturn = agent
    streamResponseHandler = async () => new Response('ok')

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)
    const service = new ChatService(createChatServiceDeps({ sessionStore }))

    const abortA = new AbortController()
    await service.processMessage(
      {
        conversationId,
        message: 'scheduled job',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: true,
      } as never,
      abortA.signal,
    )
    expect(await service.getActiveTurn(conversationId)).not.toBeNull()
    abortA.abort()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await service.getActiveTurn(conversationId)).toBeNull()
  })

  it('deleteSession cancels an active turn first', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const agent = createFakeAgent()
    agentToReturn = agent
    streamResponseHandler = async () => new Response('ok')

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)
    const service = new ChatService(createChatServiceDeps({ sessionStore }))

    await service.processMessage(
      {
        conversationId,
        message: 'bye',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )
    expect(await service.getActiveTurn(conversationId)).not.toBeNull()
    await service.deleteSession(conversationId)
    expect(await service.getActiveTurn(conversationId)).toBeNull()
  })
})

describe('ChatService session rebuild settles pending tool state', () => {
  it('settles a pending approval before sanitizing on a workspace change mid-conversation', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))

    const conversationId = crypto.randomUUID()
    const firstAgent = createFakeAgent()
    firstAgent.toolNames = new Set(['evaluate'])
    firstAgent.messages.push(
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'run something' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-evaluate',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { expression: '1' },
            approval: { id: 'approval-1' },
          } as never,
        ],
      },
    )

    // Same toolset before/after — the rebuild here is triggered by the
    // workspace change, not a toolset change, so `tool-evaluate` survives
    // the sanitize step and the settled state is directly observable.
    const secondAgent = createFakeAgent()
    secondAgent.toolNames = new Set(['evaluate'])

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent: firstAgent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
      workingDir: undefined,
    } as never)

    agentToReturn = secondAgent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({
        messages: (uiMessages ?? secondAgent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'continue',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
        userWorkingDir: '/tmp/new-workspace',
      } as never,
      new AbortController().signal,
    )

    // Before this fix the pending approval would either survive as a
    // dangling `approval-requested` part (failing the next resume/turn) or
    // be silently dropped by sanitize as if the user's earlier Approve/Deny
    // click never happened. It must land in a terminal, explicit state.
    const settledPart = secondAgent.messages
      .find((m) => m.id === 'asst-1')
      ?.parts.find(
        (p) => (p as { toolCallId?: string }).toolCallId === 'call-1',
      ) as { state?: string } | undefined
    expect(settledPart?.state).toBe('output-denied')
  })
})

describe('ChatService LLM hot-switch', () => {
  it('rebuilds the agent when provider/model changes but keeps transcript', async () => {
    const conversationId = 'conv-llm-hotswitch'
    const firstAgent = createFakeAgent()
    firstAgent.messages.push(
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello from deepseek' }],
      },
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hi' }],
      },
    )
    const secondAgent = createFakeAgent()

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent: firstAgent,
      mcpServerKey: '',
      llmKey: 'deepseek||deepseek-v4-flash||',
      chatMode: false,
    } as never)

    agentToReturn = secondAgent
    let disposeCalled = false
    firstAgent.dispose = async () => {
      disposeCalled = true
    }
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({
        messages: (uiMessages ?? secondAgent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    // resolveLLMConfigSpy already returns openai/gpt-5 — differs from deepseek llmKey
    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'continue',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )

    expect(disposeCalled).toBe(true)
    expect(createAgentSpy).toHaveBeenCalled()
    const live = sessionStore.get(conversationId)
    expect(live?.agent).toBe(secondAgent)
    expect(live?.llmKey).toBe('openai||gpt-5||')
    // Transcript carried over onto the new agent
    expect(secondAgent.messages.some((m) => m.id === 'user-1')).toBe(true)
  })
})

describe('ChatService chat/agent mode toggle', () => {
  function lastMessageText(messages: MockMessage[] | undefined): string {
    const last = messages?.[messages.length - 1]
    return (
      last?.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n') ?? ''
    )
  }

  it('rebuilds the session and tells the model when chat mode switches to agent mode', async () => {
    const conversationId = 'conv-mode-toggle-to-agent'
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent: firstAgent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: true,
    } as never)

    agentToReturn = secondAgent
    let disposeCalled = false
    firstAgent.dispose = async () => {
      disposeCalled = true
    }
    let capturedUiMessages: MockMessage[] | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      capturedUiMessages = uiMessages
      await onFinish({
        messages: (uiMessages ?? secondAgent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'go click the button',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )

    expect(disposeCalled).toBe(true)
    const live = sessionStore.get(conversationId)
    expect(live?.agent).toBe(secondAgent)
    expect(live?.chatMode).toBe(false)
    expect(lastMessageText(capturedUiMessages)).toContain(
      '[Context: The user switched from Chat mode to Agent mode',
    )
  })

  it('rebuilds the session when agent mode switches to chat mode', async () => {
    const conversationId = 'conv-mode-toggle-to-chat'
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent: firstAgent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)

    agentToReturn = secondAgent
    let disposeCalled = false
    firstAgent.dispose = async () => {
      disposeCalled = true
    }
    let capturedUiMessages: MockMessage[] | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      capturedUiMessages = uiMessages
      await onFinish({
        messages: (uiMessages ?? secondAgent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'just tell me about this page',
        mode: 'chat',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )

    expect(disposeCalled).toBe(true)
    const live = sessionStore.get(conversationId)
    expect(live?.chatMode).toBe(true)
    expect(lastMessageText(capturedUiMessages)).toContain(
      '[Context: The user switched from Agent mode to Chat mode',
    )
  })

  it('does not rebuild or notify when the mode is unchanged', async () => {
    const conversationId = 'conv-mode-unchanged'
    const firstAgent = createFakeAgent()

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent: firstAgent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: false,
    } as never)

    agentToReturn = createFakeAgent()
    let disposeCalled = false
    firstAgent.dispose = async () => {
      disposeCalled = true
    }
    let capturedUiMessages: MockMessage[] | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      capturedUiMessages = uiMessages
      await onFinish({
        messages: (uiMessages ?? firstAgent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'continue',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
      } as never,
      new AbortController().signal,
    )

    expect(disposeCalled).toBe(false)
    expect(sessionStore.get(conversationId)?.agent).toBe(firstAgent)
    expect(lastMessageText(capturedUiMessages)).not.toContain('[Context:')
  })

  it('rebuilds once and emits both notices when MCP servers and mode change together', async () => {
    const conversationId = 'conv-mode-and-mcp-together'
    const firstAgent = createFakeAgent()
    const secondAgent = createFakeAgent()

    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent: firstAgent,
      mcpServerKey: '',
      llmKey: 'openai||gpt-5||',
      chatMode: true,
      workingDir: undefined,
    } as never)

    agentToReturn = secondAgent
    let disposeCallCount = 0
    firstAgent.dispose = async () => {
      disposeCallCount += 1
    }
    let capturedUiMessages: MockMessage[] | undefined
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      capturedUiMessages = uiMessages
      await onFinish({
        messages: (uiMessages ?? secondAgent.messages) as MockMessage[],
      })
      return new Response('ok')
    }

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'check integrations and go do it',
        mode: 'agent',
        origin: 'sidepanel',
        isScheduledTask: false,
        browserContext: {
          activeTab: { id: 3, url: 'https://example.com', title: 'Example' },
          enabledMcpServers: ['gmail'],
        },
      } as never,
      new AbortController().signal,
    )

    // Exactly one rebuild for two simultaneous changes, not two.
    expect(disposeCallCount).toBe(1)
    const text = lastMessageText(capturedUiMessages)
    expect(text).toContain('gmail')
    expect(text).toContain(
      '[Context: The user switched from Chat mode to Agent mode',
    )
    const live = sessionStore.get(conversationId)
    expect(live?.chatMode).toBe(false)
    expect(live?.mcpServerKey).toBe('gmail')
  })

  it('pins chatMode to false for ACP providers regardless of request.mode', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'claude-code',
      model: 'opus',
      apiKey: 'unused',
    }))

    const agent = createFakeAgent()
    agentToReturn = agent
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? [] })
      return new Response('ok')
    }

    const service = new ChatService(createChatServiceDeps())
    await service.processMessage(
      {
        conversationId: 'conv-acp-mode-pin',
        message: 'hello',
        mode: 'chat',
        origin: 'sidepanel',
        isScheduledTask: false,
        browserContext: {
          activeTab: { id: 1, url: 'https://example.com', title: 'Example' },
        },
      } as never,
      new AbortController().signal,
    )

    const createArgs = createAgentSpy.mock.calls.at(-1)?.[0] as {
      resolvedConfig?: { chatMode?: boolean }
    }
    expect(createArgs.resolvedConfig?.chatMode).toBe(false)

    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  })

  it('does not rebuild an ACP session when request.mode toggles mid-conversation', async () => {
    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'claude-code',
      model: 'opus',
      apiKey: 'unused',
    }))

    const conversationId = 'conv-acp-mode-toggle'
    const firstAgent = createFakeAgent()
    const sessionStore = createSessionStore()
    sessionStore.set(conversationId, {
      agent: firstAgent,
      mcpServerKey: '',
      llmKey: 'claude-code||opus||',
      chatMode: false,
    } as never)

    let disposeCalled = false
    firstAgent.dispose = async () => {
      disposeCalled = true
    }
    streamResponseHandler = async ({ onFinish, uiMessages }) => {
      await onFinish({ messages: uiMessages ?? firstAgent.messages })
      return new Response('ok')
    }

    const service = new ChatService(createChatServiceDeps({ sessionStore }))
    await service.processMessage(
      {
        conversationId,
        message: 'hello again',
        mode: 'chat',
        origin: 'sidepanel',
        isScheduledTask: false,
        browserContext: {
          activeTab: { id: 1, url: 'https://example.com', title: 'Example' },
        },
      } as never,
      new AbortController().signal,
    )

    expect(disposeCalled).toBe(false)
    expect(sessionStore.get(conversationId)?.agent).toBe(firstAgent)

    resolveLLMConfigSpy.mockImplementation(async () => ({
      provider: 'openai',
      model: 'gpt-5',
      apiKey: 'test-key',
    }))
  })
})
