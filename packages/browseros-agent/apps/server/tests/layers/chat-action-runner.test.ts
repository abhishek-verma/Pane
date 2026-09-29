import { afterAll, expect, it, mock } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { MockLanguageModelV3 } from 'ai/test'
import type { TranslationRun } from '../../src/layers/action-runner'

const root = mkdtempSync(join(tmpdir(), 'layer-chat-runtime-'))
const previousBrowserosDir = process.env.BROWSEROS_DIR
process.env.BROWSEROS_DIR = root
let steps = 0
let inspectionSteps = 30
let observedTools: string[] = []
let capturedConfig: Record<string, unknown> = {}
const model = new MockLanguageModelV3({
  doStream: async (options) => {
    steps++
    observedTools = (options.tools ?? []).map((tool) => tool.name)
    const name =
      steps <= inspectionSteps
        ? 'page_inspect'
        : steps === inspectionSteps + 1
          ? 'page_execute_script'
          : steps === inspectionSteps + 2
            ? 'complete_page_task'
            : null
    const input =
      name === 'page_execute_script'
        ? {
            source:
              '(() => { const n = document.createElement("div"); n.id = "result"; paneLayer.own(n); document.body.append(n); })();',
            assertions: [
              {
                id: 'result',
                selector: '#result',
                state: 'present',
                maxMatches: 1,
              },
            ],
          }
        : {}
    return {
      stream: new ReadableStream<LanguageModelV3StreamPart>({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          if (name)
            controller.enqueue({
              type: 'tool-call',
              toolCallId: `step-${steps}`,
              toolName: name,
              input: JSON.stringify(input),
            })
          else {
            controller.enqueue({ type: 'text-start', id: 'done' })
            controller.enqueue({
              type: 'text-delta',
              id: 'done',
              delta: 'Completed and verified.',
            })
            controller.enqueue({ type: 'text-end', id: 'done' })
          }
          controller.enqueue({
            type: 'finish',
            finishReason: {
              unified: name ? 'tool-calls' : 'stop',
              raw: 'fixture',
            },
            usage: {
              inputTokens: {
                total: 100,
                noCache: 100,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 20, text: 20, reasoning: 0 },
            },
          })
          controller.close()
        },
      }),
    }
  },
})
mock.module('../../src/agent/provider-factory', () => ({
  createLanguageModel: async (config: Record<string, unknown>) => {
    capturedConfig = config
    return { model }
  },
  resolveAcpWorkspacePath: () => root,
}))
mock.module('../../src/agent/tool-adapter', () => ({
  buildBrowserToolSet: () => ({}),
}))
mock.module('../../src/agent/mcp-builder', () => ({
  buildMcpServerSpecs: async () => [],
  createMcpClients: async () => ({ clients: [], tools: {} }),
}))
mock.module('../../src/lib/clients/llm/config', () => ({
  resolveLLMConfig: async (config: Record<string, unknown>) => config,
}))
const { ChatService } = await import('../../src/api/services/chat-service')
const { ChatRequestSchema } = await import('../../src/api/types')
const { SessionStore } = await import('../../src/agent/session-store')
const { closeDb, initializeDb } = await import('../../src/lib/db')
const { createLayerChatRunner } = await import(
  '../../src/layers/chat-action-runner'
)
const { layerBroker } = await import('../../src/layers/broker')
const { rememberLayerChatContext, bindLayerAuthoringChat } = await import(
  '../../src/layers/chat-context'
)
const { getLayerChatTools } = await import('../../src/layers/chat-tools')
initializeDb({ dbPath: join(root, 'test.db') })
const sessions = new SessionStore()
afterAll(async () => {
  sessions.evictIdleSessions(0)
  closeDb()
  rmSync(root, { recursive: true, force: true })
  if (previousBrowserosDir === undefined) delete process.env.BROWSEROS_DIR
  else process.env.BROWSEROS_DIR = previousBrowserosDir
  mock.restore()
})

it('runs beyond 20 steps through the actual chat service and SDK loop with inherited workspace and context', async () => {
  const conversationId = randomUUID(),
    profileId = randomUUID()
  const parent = ChatRequestSchema.parse({
    conversationId,
    provider: 'openai',
    providerId: 'saved',
    model: 'custom-deployment',
    userWorkingDir: root,
    workspaceId: 'project',
    userSystemPrompt: 'Keep project conventions.',
    browserContext: { enabledMcpServers: ['saved-connector'] },
  })
  rememberLayerChatContext(parent)
  bindLayerAuthoringChat('fixture', 'a'.repeat(64), conversationId)
  await sessions.persistMessages(conversationId, [
    {
      id: 'context',
      role: 'user',
      parts: [{ type: 'text', text: 'Use the project design conventions.' }],
    },
  ])
  const doc = {
    tabId: 7,
    documentId: randomUUID(),
    instanceId: randomUUID(),
    routeEpoch: 0,
    url: 'https://example.com/',
    title: 'Fixture',
    active: true,
  }
  layerBroker.connect(
    profileId,
    randomUUID(),
    [doc],
    true,
    [{ id: 'saved', type: 'openai', model: 'custom-deployment', updatedAt: 1 }],
    true,
  )
  const service = new ChatService({
    sessionStore: sessions,
    browser: {
      resolveTabIds: async () => new Map([[7, 7]]),
      listPages: async () => [],
    } as never,
    browserSession: {} as never,
    serverPort: 9000,
  })
  const run: TranslationRun = {
    binding: {
      profileId,
      invocationId: randomUUID(),
      layerId: 'fixture',
      layerVersion: 'a'.repeat(64),
      actionId: 'draw',
      tabId: 7,
      frameId: 0,
      documentId: doc.documentId,
      instanceId: doc.instanceId,
      routeEpoch: 0,
      snapshotId: randomUUID(),
      revocationGeneration: 0,
    },
    input: { schema: 'pane.script-task-input.v1' },
    action: {
      id: 'draw',
      kind: 'page-task',
      execution: 'javascript',
      trigger: 'click',
      instruction: 'Build and verify the view.',
      outputSchema: 'pane.script-task-receipt.v1',
      providerId: 'saved',
      limits: { maxSteps: 3, maxOutputTokens: 512, deadlineMs: 1000 },
    },
    config: {
      provider: 'openai',
      providerId: 'saved',
      model: 'custom-deployment',
      apiKey: 'fixture',
    },
    signal: new AbortController().signal,
    current: () => true,
    pageHost: {
      inspect: async () => ({ title: 'Fixture' }),
      execute: async () => ({
        checks: [{ operationId: 'result', affectedElements: 1, intact: true }],
      }),
    },
  }
  const result = await createLayerChatRunner(service, sessions)(run)
  expect(result.schema).toBe('pane.script-task-receipt.v1')
  expect(steps).toBe(32)
  expect(observedTools).toContain('filesystem_read')
  expect(observedTools).toContain('filesystem_bash')
  expect(observedTools).toContain('skills_load')
  expect(observedTools).toContain('page_execute_script')
  expect(capturedConfig.workingDir).toBe(root)
  expect(capturedConfig.model).toBe('custom-deployment')
  expect(capturedConfig.userSystemPrompt).toBe('Keep project conventions.')
  const messages = await sessions.loadMessages(run.binding.invocationId)
  expect(JSON.stringify(messages)).toContain(
    'Use the project design conventions.',
  )
  expect(Object.keys(getLayerChatTools(run.binding.invocationId))).toHaveLength(
    0,
  )
  expect(await sessions.loadMessages(conversationId)).toHaveLength(1)
}, 30000)

it('keeps invocation tools scoped and revokes tool objects already captured by a session', async () => {
  const { registerLayerChatTools } = await import('../../src/layers/chat-tools')
  const { tool } = await import('ai')
  const { z } = await import('zod')
  const id = randomUUID()
  const release = registerLayerChatTools(id, {
    fixture: tool({
      inputSchema: z.object({}),
      execute: async () => ({ ok: true }),
    }),
  })
  const captured = getLayerChatTools(id).fixture
  expect(Object.keys(getLayerChatTools(randomUUID()))).toHaveLength(0)
  expect(await captured.execute?.({}, {} as never)).toEqual({ ok: true })
  release()
  await expect(captured.execute?.({}, {} as never)).rejects.toThrow('ended')
})

it('retains normal tools and the same completion channel on the ACP MCP surface', async () => {
  const { registerLayerChatTools } = await import('../../src/layers/chat-tools')
  const { createMcpServer } = await import(
    '../../src/api/services/mcp/mcp-server'
  )
  const { createScriptPageTools } = await import(
    '../../src/layers/script-page-task'
  )
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { InMemoryTransport } = await import(
    '@modelcontextprotocol/sdk/inMemory.js'
  )
  const id = randomUUID()
  const controller = new AbortController()
  let inspected = 0,
    completed = false
  const run = {
    current: () => true,
    signal: controller.signal,
    pageHost: {
      inspect: async () => {
        inspected++
        return { title: 'Originating page' }
      },
      execute: async () => ({
        checks: [{ operationId: 'result', affectedElements: 1, intact: true }],
      }),
    },
  } as TranslationRun
  const release = registerLayerChatTools(
    id,
    createScriptPageTools(run, () => {
      completed = true
    }),
  )
  const server = createMcpServer({
    version: 'fixture',
    browserSession: { pages: {} } as never,
    executionDir: root,
    scopeId: id,
    workspace: { root } as never,
  })
  const client = new Client({ name: 'custom-acp-fixture', version: '1' })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names).toContain('tabs')
    expect(names).toContain('filesystem_read')
    expect(names).toContain('skills_load')
    expect(names).toContain('page_execute_script')
    for (let step = 0; step < 25; step++) {
      const response = await client.callTool({
        name: 'page_inspect',
        arguments: {},
      })
      expect(response.isError).toBeFalsy()
    }
    expect(inspected).toBe(25)
    const execution = await client.callTool({
      name: 'page_execute_script',
      arguments: {
        source: '(() => {})();',
        assertions: [
          {
            id: 'result',
            selector: '#result',
            state: 'present',
            maxMatches: 1,
          },
        ],
      },
    })
    expect(execution.isError).toBeFalsy()
    const receipt = await client.callTool({
      name: 'complete_page_task',
      arguments: {},
    })
    expect(receipt.isError).toBeFalsy()
    expect(completed).toBe(true)
  } finally {
    release()
    await client.close()
    await server.close()
  }
}, 10000)

function waitingFixture() {
  const profileId = randomUUID(),
    invocationId = randomUUID()
  const controller = new AbortController()
  const doc = {
    tabId: 12,
    documentId: randomUUID(),
    instanceId: randomUUID(),
    routeEpoch: 0,
    url: 'https://example.com/',
    title: 'Fixture',
    active: true,
  }
  layerBroker.connect(profileId, randomUUID(), [doc], true, [], true)
  const run: TranslationRun = {
    binding: {
      profileId,
      invocationId,
      layerId: 'waiting',
      layerVersion: 'b'.repeat(64),
      actionId: 'draw',
      tabId: doc.tabId,
      frameId: 0,
      documentId: doc.documentId,
      instanceId: doc.instanceId,
      routeEpoch: 0,
      snapshotId: randomUUID(),
      revocationGeneration: 0,
    },
    input: { schema: 'pane.script-task-input.v1' },
    action: {
      id: 'draw',
      kind: 'page-task',
      execution: 'javascript',
      trigger: 'click',
      instruction: 'Build the view.',
      outputSchema: 'pane.script-task-receipt.v1',
      limits: { maxSteps: 3, maxOutputTokens: 512, deadlineMs: 1000 },
    },
    config: {
      provider: 'acp-custom',
      providerId: 'waiting-provider',
      model: 'custom-alias',
      acpAgentId: 'custom-agent',
      acpCommand: 'custom-agent --acp',
      acpFixedWorkspacePath: root,
    },
    signal: controller.signal,
    current: () => true,
    pageHost: {
      inspect: async () => ({}),
      execute: async () => ({
        checks: [{ operationId: 'result', affectedElements: 1, intact: true }],
      }),
    },
  }
  const pendingSession = {
    agent: {
      messages: [
        {
          role: 'assistant',
          parts: [{ type: 'tool-tasks_add', state: 'approval-requested' }],
        },
      ],
    },
  }
  let cancelled = 0
  const service = {
    processMessage: async (request: Record<string, unknown>) => {
      expect(request.provider).toBe('acp-custom')
      expect(request.model).toBe('custom-alias')
      expect(request.acpCommand).toBe('custom-agent --acp')
      expect(request.acpFixedWorkspacePath).toBe(root)
      return new Response('')
    },
    cancelTurn: () => {
      cancelled++
      return true
    },
  }
  const store = { get: () => pendingSession }
  return {
    run,
    controller,
    cancelled: () => cancelled,
    start: () => createLayerChatRunner(service as never, store as never)(run),
  }
}

it('keeps the result channel live across an approval pause and accepts resumed completion', async () => {
  const f = waitingFixture()
  const promise = f.start()
  await Bun.sleep(25)
  const tools = getLayerChatTools(f.run.binding.invocationId)
  expect(Object.keys(tools)).toContain('complete_page_task')
  await tools.page_inspect.execute?.({}, {} as never)
  await tools.page_execute_script.execute?.(
    {
      source: '(() => {})();',
      assertions: [
        { id: 'result', selector: '#result', state: 'present', maxMatches: 1 },
      ],
    },
    {} as never,
  )
  await tools.complete_page_task.execute?.({}, {} as never)
  expect((await promise).schema).toBe('pane.script-task-receipt.v1')
  expect(f.cancelled()).toBe(0)
})

it('cancels the normal chat and revokes completion tools while waiting for approval', async () => {
  const f = waitingFixture()
  const promise = f.start()
  await Bun.sleep(25)
  f.controller.abort()
  await expect(promise).rejects.toThrow()
  expect(f.cancelled()).toBeGreaterThan(0)
  expect(
    Object.keys(getLayerChatTools(f.run.binding.invocationId)),
  ).toHaveLength(0)
})

it('retains the normal 100-step ceiling instead of running without a bound', async () => {
  steps = 0
  inspectionSteps = 200
  const f = waitingFixture()
  f.run.config = {
    provider: 'openai',
    providerId: 'ceiling',
    model: 'custom-deployment',
  }
  const service = new ChatService({
    sessionStore: sessions,
    browser: {
      resolveTabIds: async () => new Map([[12, 12]]),
      listPages: async () => [],
    } as never,
    browserSession: {} as never,
    serverPort: 9000,
  })
  await expect(
    createLayerChatRunner(service, sessions)(f.run),
  ).rejects.toThrow()
  expect(steps).toBe(100)
  expect(
    Object.keys(getLayerChatTools(f.run.binding.invocationId)),
  ).toHaveLength(0)
}, 30000)
