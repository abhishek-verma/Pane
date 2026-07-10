import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { SessionStore } from '../../../src/agent/session-store'
import { ChatService } from '../../../src/api/services/chat-service'
import { closeDb, initializeDb } from '../../../src/lib/db'

describe('ChatService history source of truth', () => {
  let tmpDir: string
  let dbPath: string
  let store: SessionStore
  let service: ChatService

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browseros-history-'))
    dbPath = join(tmpDir, 'test.db')
    initializeDb({ dbPath, runMigrations: true })
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
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('lists slim history with preview text only', async () => {
    const id = crypto.randomUUID()
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'write hello.txt' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { path: 'hello.txt', content: 'hi' },
            output: [{ type: 'text', text: 'ok' }],
          } as never,
        ],
      },
    ]
    await store.persistMessages(id, messages)

    const history = await service.getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]?.id).toBe(id)
    expect(history[0]?.previewText).toBe('write hello.txt')
    expect(history[0]).not.toHaveProperty('messages')
  })

  it('returns full UIMessage parts from getConversation', async () => {
    const id = crypto.randomUUID()
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_write',
            toolCallId: 'call-1',
            state: 'approval-requested',
            input: { path: 'a.txt', content: 'x' },
            approval: { id: 'approval-1' },
          } as never,
        ],
      },
    ]
    await store.persistMessages(id, messages)

    const conversation = await service.getConversation(id)
    expect(conversation?.id).toBe(id)
    expect(conversation?.messages).toHaveLength(2)
    const toolPart = conversation?.messages[1]?.parts[0] as {
      state?: string
      toolCallId?: string
    }
    expect(toolPart.state).toBe('approval-requested')
    expect(toolPart.toolCallId).toBe('call-1')
  })

  it('imports conversations idempotently', async () => {
    const id = crypto.randomUUID()
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'imported' }],
      },
    ]

    const first = await service.importConversations([
      { id, messages, lastMessagedAt: Date.now() },
    ])
    expect(first).toEqual({ imported: 1, skipped: 0 })

    const second = await service.importConversations([
      { id, messages, lastMessagedAt: Date.now() },
    ])
    expect(second).toEqual({ imported: 0, skipped: 1 })

    const conversation = await service.getConversation(id)
    expect(conversation?.messages[0]?.parts[0]).toMatchObject({
      type: 'text',
      text: 'imported',
    })
  })

  it('deletes persisted sessions that are not live in memory', async () => {
    const id = crypto.randomUUID()
    await store.persistMessages(id, [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'bye' }],
      },
    ])

    const result = await service.deleteSession(id)
    expect(result.deleted).toBe(true)
    expect(await service.getConversation(id)).toBeNull()
  })

  it('loadMessages round-trips tool parts used for restart hydration', async () => {
    const id = crypto.randomUUID()
    await store.persistMessages(id, [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'write hello.txt' }],
      },
      {
        id: 'a1',
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
    ])

    // Simulate server restart: empty live map, DB still has the transcript.
    expect(store.get(id)).toBeUndefined()
    const loaded = await store.loadMessages(id)
    const toolPart = loaded[1]?.parts?.[0] as {
      state?: string
      toolCallId?: string
    }
    expect(toolPart.state).toBe('approval-requested')
    expect(toolPart.toolCallId).toBe('call-1')
  })
})
