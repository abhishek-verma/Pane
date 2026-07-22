import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { SessionStore, ToolImageStore } from '../../src/agent/session-store'
import { closeDb, getDb, initializeDb } from '../../src/lib/db'
import { chatSessions } from '../../src/lib/db/schema/chat-sessions'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDb(): { tmpDir: string; dbPath: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), 'browseros-test-db-'))
  return { tmpDir, dbPath: join(tmpDir, 'test.db') }
}

// ---------------------------------------------------------------------------
// SessionStore Persistence (existing)
// ---------------------------------------------------------------------------

describe('SessionStore Persistence', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    const t = makeTmpDb()
    tmpDir = t.tmpDir
    dbPath = t.dbPath
    initializeDb({ dbPath, runMigrations: true })
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('persists and loads messages correctly', async () => {
    const store = new SessionStore()
    const sessionId = 'test-session-1'

    const messages: UIMessage[] = [
      { id: '1', role: 'user', content: 'Hello' },
      { id: '2', role: 'assistant', content: 'Hi there' },
    ]

    await store.persistMessages(sessionId, messages)

    const loaded = await store.loadMessages(sessionId)
    expect(loaded.length).toBe(2)
    expect(loaded[0].role).toBe('user')
    expect(loaded[0].content).toEqual('Hello')
    expect(loaded[1].role).toBe('assistant')
    expect(loaded[1].content).toEqual('Hi there')

    const db = getDb()
    const session = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .get()
    expect(session).toBeDefined()
    expect(session?.id).toBe(sessionId)
  })

  it('loadMessages tolerates rows that stored a full UIMessage object', async () => {
    const store = new SessionStore()
    const sessionId = 'legacy-full-msg'
    const now = Date.now()
    const db = getDb()
    await db.insert(chatSessions).values({
      id: sessionId,
      createdAt: now,
      updatedAt: now,
    })
    const { chatMessages } = await import(
      '../../src/lib/db/schema/chat-sessions'
    )
    await db.insert(chatMessages).values({
      id: `${sessionId}-1`,
      sessionId,
      role: 'assistant',
      content: JSON.stringify({
        id: 'msg-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-act',
            toolCallId: 'c1',
            toolName: 'act',
            state: 'output-available',
            input: {},
            output: {
              content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }],
            },
          },
        ],
      }),
      createdAt: now,
    })

    const loaded = await store.loadMessages(sessionId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.parts).toHaveLength(1)
    expect((loaded[0]?.parts[0] as { toolCallId?: string }).toolCallId).toBe(
      'c1',
    )
  })
})

// ---------------------------------------------------------------------------
// ToolImageStore
// ---------------------------------------------------------------------------

describe('ToolImageStore', () => {
  let tmpDir: string

  beforeEach(() => {
    const t = makeTmpDb()
    tmpDir = t.tmpDir
    initializeDb({ dbPath: t.dbPath, runMigrations: true })
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('stores and retrieves an image by toolCallId', () => {
    const store = new ToolImageStore()
    const data = Buffer.from('fake-jpeg-bytes').toString('base64')
    store.store('sess-1', 'call-1', data, 'image/jpeg')

    const result = store.get('call-1')
    expect(result).not.toBeNull()
    expect(result?.mimeType).toBe('image/jpeg')
    // Round-trip: stored as Buffer, retrieved as Buffer
    expect(Buffer.from(result!.data).toString('base64')).toBe(data)
  })

  it('returns null for an unknown toolCallId', () => {
    const store = new ToolImageStore()
    expect(store.get('nonexistent-call')).toBeNull()
  })

  it('overwrites an existing entry with INSERT OR REPLACE', () => {
    const store = new ToolImageStore()
    const data1 = Buffer.from('old').toString('base64')
    const data2 = Buffer.from('new').toString('base64')
    store.store('sess', 'call-1', data1, 'image/png')
    store.store('sess', 'call-1', data2, 'image/jpeg')

    const result = store.get('call-1')
    expect(result?.mimeType).toBe('image/jpeg')
    expect(Buffer.from(result!.data).toString('base64')).toBe(data2)
  })

  it('stores multiple images for the same session', () => {
    const store = new ToolImageStore()
    store.store('sess', 'call-1', 'A', 'image/png')
    store.store('sess', 'call-2', 'B', 'image/jpeg')
    store.store('sess', 'call-3', 'C', 'image/png')

    expect(store.get('call-1')).not.toBeNull()
    expect(store.get('call-2')).not.toBeNull()
    expect(store.get('call-3')).not.toBeNull()
  })

  it('deleteForSession removes all images for that session only', () => {
    const store = new ToolImageStore()
    store.store('sess-A', 'call-1', 'DATA1', 'image/png')
    store.store('sess-A', 'call-2', 'DATA2', 'image/png')
    store.store('sess-B', 'call-3', 'DATA3', 'image/png')

    store.deleteForSession('sess-A')

    expect(store.get('call-1')).toBeNull()
    expect(store.get('call-2')).toBeNull()
    // sess-B images untouched
    expect(store.get('call-3')).not.toBeNull()
  })

  it('deleteForSession is a no-op when session has no images', () => {
    const store = new ToolImageStore()
    expect(() => store.deleteForSession('never-existed')).not.toThrow()
  })

  it('table is lazily created on first use', () => {
    // ToolImageStore creates the table on first call — no pre-init needed
    const store = new ToolImageStore()
    expect(() => store.store('s', 'c', 'D', 'image/png')).not.toThrow()
    expect(store.get('c')).not.toBeNull()
  })

  it('SessionStore.imageStore is a shared ToolImageStore instance', () => {
    const sessionStore = new SessionStore()
    expect(sessionStore.imageStore).toBeInstanceOf(ToolImageStore)
    // Same reference across calls
    expect(sessionStore.imageStore).toBe(sessionStore.imageStore)
  })
})
