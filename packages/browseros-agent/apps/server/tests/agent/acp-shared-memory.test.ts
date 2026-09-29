import { afterAll, afterEach, beforeEach, expect, it, mock } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { createDefaultMcpGateContext } from '@browseros/browser-mcp/trust/mcp-gate'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AcpxProvider } from 'acpx-ai-provider'
import { registerContextMcpTools } from '../../src/context/register-mcp'
import { PaneAcpLanguageModel } from '../../src/lib/agents/acp/language-model'
import { prepareAcpxAgentContext } from '../../src/lib/agents/acpx/agent-adapter'
import { closeDb, initializeDb } from '../../src/lib/db'
import { readPromptFiles } from '../../src/memory/files'
import { listEntries } from '../../src/memory/store'

// Replace only the external provider process; use the actual AI SDK loop,
// ACP prompt converter, MCP protocol, memory files, and SQLite index.
const require = createRequire(import.meta.url)
const realFactory = { ...require('../../src/agent/provider-factory') }
const turns: string[] = []
let fresh = true
mock.module('../../src/agent/provider-factory', () => ({
  ...realFactory,
  createLanguageModel: async () => ({
    model: new PaneAcpLanguageModel({
      settings: { agent: 'memory-test' },
      generateId: () => crypto.randomUUID(),
      ensureHandle: async () => ({ handle: {}, sessionKey: 'memory-chat' }),
      markSessionKeyUsed: () => {
        const first = fresh
        fresh = false
        return first
      },
      runtime: {
        startTurn(input: { text: string }) {
          turns.push(input.text)
          return {
            events: (async function* () {
              yield { type: 'text_delta', text: 'OK' }
            })(),
            result: Promise.resolve({
              status: 'completed',
              stopReason: 'end_turn',
            }),
            cancel: async () => {},
          }
        },
      },
    } as unknown as AcpxProvider),
    close: async () => {},
  }),
}))
const { AiSdkAgent } = await import('../../src/agent/ai-sdk-agent')
afterAll(() =>
  mock.module('../../src/agent/provider-factory', () => realFactory),
)

let root: string
const originalDir = process.env.BROWSEROS_DIR
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pane-shared-acp-memory-'))
  process.env.BROWSEROS_DIR = root
  initializeDb({ dbPath: join(root, 'test.sqlite') })
  fresh = true
  turns.length = 0
})
afterEach(async () => {
  closeDb()
  if (originalDir === undefined) delete process.env.BROWSEROS_DIR
  else process.env.BROWSEROS_DIR = originalDir
  await rm(root, { recursive: true, force: true })
})

it.each([
  'claude-code',
  'codex',
] as const)('%s uses and updates the same memory as Pane Settings on subsequent turns', async (provider) => {
  const server = new McpServer({ name: 'browseros', version: 'test' })
  registerContextMcpTools(server, {
    gateContext: createDefaultMcpGateContext({
      pins: { 'write-local': { pinned: true } },
    }),
  })
  const client = new Client({ name: provider, version: 'test' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  await client.connect(ct)
  const agent = await AiSdkAgent.create({
    resolvedConfig: {
      conversationId: 'memory-chat',
      provider,
      model: 'test-model',
    },
    browserSession: { pages: {} } as unknown as BrowserSession,
  })
  try {
    await agent.toolLoopAgent.generate({ prompt: 'First request' })
    expect(turns[0]).toContain('Do not substitute native CLI memory')
    const write = await client.callTool({
      name: 'memory_add',
      arguments: { content: 'Prefers jasmine tea in the morning.' },
    })
    expect(write.isError).not.toBe(true)
    expect(
      listEntries({ layer: 'memory', status: ['active'] }).some((e) =>
        e.content.includes('jasmine tea'),
      ),
    ).toBe(true)
    expect((await readPromptFiles()).memory).toContain('jasmine tea')

    await agent.toolLoopAgent.generate({ prompt: 'Second request' })
    expect(turns[1]).toContain('jasmine tea')
    expect(turns[1]).not.toContain('First request')

    const replace = await client.callTool({
      name: 'memory_replace',
      arguments: {
        match: 'jasmine tea',
        content: 'Prefers mint tea in the morning.',
      },
    })
    expect(replace.isError).not.toBe(true)
    await agent.toolLoopAgent.generate({ prompt: 'Third request' })
    expect(turns[2]).toContain('mint tea')
    expect(turns[2]).not.toContain('jasmine tea')

    // The standalone agent harness must receive the same shared snapshot.
    const adapter = provider === 'codex' ? 'codex' : 'claude'
    const prepared = await prepareAcpxAgentContext({
      browserosDir: root,
      agent: {
        id: 'agent',
        name: 'Test',
        adapter,
        permissionMode: 'approve-all',
        sessionKey: 'agent:main',
        createdAt: 0,
        updatedAt: 0,
      },
      sessionId: 'main',
      sessionKey: 'agent:main',
      cwdOverride: null,
      isSelectedCwd: false,
      message: 'Recall my preference',
    })
    expect(prepared.runPrompt).toContain('mint tea')
    expect(prepared.runPrompt).toContain('browseros MCP memory_add tool')

    const remove = await client.callTool({
      name: 'memory_remove',
      arguments: { match: 'mint tea' },
    })
    expect(remove.isError).not.toBe(true)
    await agent.toolLoopAgent.generate({ prompt: 'Fourth request' })
    expect(turns[3]).not.toContain('mint tea')
    expect((await readPromptFiles()).memory).not.toContain('mint tea')

    const profile = await client.callTool({
      name: 'user_edit',
      arguments: { content: '# User\nPrefers concise project updates.' },
    })
    expect(profile.isError).not.toBe(true)
    await agent.toolLoopAgent.generate({ prompt: 'Fifth request' })
    expect(turns[4]).toContain('Prefers concise project updates.')
    await agent.toolLoopAgent.generate({ prompt: 'Unchanged context' })
    expect(turns[5]).toContain('Unchanged context')
  } finally {
    await agent.dispose()
    await client.close()
    await server.close()
  }
})

it('keeps shared memory writes subject to approval and excludes them in read-only chat', async () => {
  const server = new McpServer({ name: 'browseros', version: 'test' })
  registerContextMcpTools(server, {
    gateContext: createDefaultMcpGateContext({
      requestApproval: async () => 'denied',
    }),
  })
  const client = new Client({ name: 'memory-denied', version: 'test' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  await client.connect(ct)
  try {
    const result = await client.callTool({
      name: 'memory_add',
      arguments: { content: 'A denied preference.' },
    })
    expect(result.isError).toBe(true)
    expect(listEntries({ layer: 'memory', status: ['active'] })).toHaveLength(0)
  } finally {
    await client.close()
    await server.close()
  }

  const readOnly = new McpServer({
    name: 'browseros-readonly',
    version: 'test',
  })
  registerContextMcpTools(readOnly, { chatMode: true })
  const reader = new Client({ name: 'memory-reader', version: 'test' })
  const [rc, rs] = InMemoryTransport.createLinkedPair()
  await readOnly.connect(rs)
  await reader.connect(rc)
  try {
    const names = (await reader.listTools()).tools.map((t) => t.name)
    expect(names).toContain('context_search')
    for (const name of [
      'memory_add',
      'memory_replace',
      'memory_remove',
      'user_edit',
      'soul_edit',
    ])
      expect(names).not.toContain(name)
  } finally {
    await reader.close()
    await readOnly.close()
  }
})
