import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import type { AiSdkAgent } from '../../src/agent/ai-sdk-agent'
import { conversationTurnRegistry } from '../../src/agent/conversation-turn-registry'
import {
  type AgentSession,
  SessionStore,
  ToolImageStore,
  ToolOutputStore,
} from '../../src/agent/session-store'
import { closeDb, getDb, initializeDb } from '../../src/lib/db'
import { chatSessions } from '../../src/lib/db/schema/chat-sessions'

function makeFakeSession(): {
  session: AgentSession
  getDisposeCalls: () => number
} {
  let disposeCalls = 0
  const agent = {
    dispose: async () => {
      disposeCalls++
    },
  } as unknown as AiSdkAgent
  return {
    session: { agent },
    getDisposeCalls: () => disposeCalls,
  }
}

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
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
      {
        id: '2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi there' }],
      },
    ]

    await store.persistMessages(sessionId, messages)

    const loaded = await store.loadMessages(sessionId)
    expect(loaded.length).toBe(2)
    expect(loaded[0].role).toBe('user')
    expect(loaded[0].id).toBe('1')
    expect(loaded[0].parts).toEqual([{ type: 'text', text: 'Hello' }])
    expect(loaded[1].role).toBe('assistant')
    expect(loaded[1].id).toBe('2')
    expect(loaded[1].parts).toEqual([{ type: 'text', text: 'Hi there' }])

    const db = getDb()
    const session = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .get()
    expect(session).toBeDefined()
    expect(session?.id).toBe(sessionId)
  })

  it('preserves UIMessage.id across persist/load and re-checkpoint', async () => {
    const store = new SessionStore()
    const sessionId = 'stable-ids'
    const messages: UIMessage[] = [
      {
        id: 'user-uuid',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      },
      {
        id: 'asst-uuid',
        role: 'assistant',
        parts: [{ type: 'text', text: 'hello' }],
      },
    ]

    await store.persistMessages(sessionId, messages, { syncIndexes: false })
    let loaded = await store.loadMessages(sessionId)
    expect(loaded.map((m) => m.id)).toEqual(['user-uuid', 'asst-uuid'])

    const first = messages[0]
    if (!first) throw new Error('expected user message')
    const updated: UIMessage[] = [
      first,
      {
        id: 'asst-uuid',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: ' more' },
        ],
      },
    ]
    await store.persistMessages(sessionId, updated, { syncIndexes: false })
    loaded = await store.loadMessages(sessionId)
    expect(loaded.map((m) => m.id)).toEqual(['user-uuid', 'asst-uuid'])
    expect(
      (loaded[1]?.parts ?? [])
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text?: string }).text)
        .join(''),
    ).toBe('hello more')
  })

  it('falls back to a generated id when UIMessage.id is missing', async () => {
    const store = new SessionStore()
    const sessionId = 'missing-id'
    await store.persistMessages(
      sessionId,
      [
        {
          id: '',
          role: 'user',
          parts: [{ type: 'text', text: 'x' }],
        } as UIMessage,
      ],
      { syncIndexes: false },
    )
    const loaded = await store.loadMessages(sessionId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.id.startsWith(`${sessionId}-msg-`)).toBe(true)
  })

  it('loads legacy parts-only rows using the synthetic row id', async () => {
    const store = new SessionStore()
    const sessionId = 'legacy-parts'
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
      id: `${sessionId}-msg-0-${now}`,
      sessionId,
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'legacy' }]),
      createdAt: now,
    })
    const loaded = await store.loadMessages(sessionId)
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.id).toBe(`${sessionId}-msg-0-${now}`)
    expect(loaded[0]?.parts).toEqual([{ type: 'text', text: 'legacy' }])
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
    expect(Buffer.from(result?.data).toString('base64')).toBe(data)
  })

  it('returns a real Buffer whose .toString("base64") round-trips directly', () => {
    // Regression: bun:sqlite returns BLOB columns as a plain Uint8Array.
    // Uint8Array#toString() ignores its argument and joins bytes as
    // comma-separated decimals instead of base64-encoding them — a caller
    // that trusts the `data: Buffer` type and calls `.toString('base64')`
    // directly (as rehydrateImagesForModel does) would silently send
    // garbage to the model/provider. Assert the *unwrapped* value here so
    // this test fails if ToolImageStore.get() ever regresses to returning
    // a raw Uint8Array again.
    const store = new ToolImageStore()
    const jpegLikeBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    const data = jpegLikeBytes.toString('base64')
    store.store('sess-1', 'call-1', data, 'image/jpeg')

    const result = store.get('call-1')
    expect(result).not.toBeNull()
    expect(Buffer.isBuffer(result?.data)).toBe(true)
    expect(result?.data.toString('base64')).toBe(data)
    // A comma-joined Uint8Array#toString() would be many times longer than
    // the correct base64 string — pin the exact expected length too.
    expect(result?.data.toString('base64').length).toBe(data.length)
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
    expect(Buffer.from(result?.data).toString('base64')).toBe(data2)
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

describe('SessionStore idle eviction', () => {
  let store: SessionStore

  beforeEach(() => {
    store = new SessionStore()
  })

  afterEach(() => {
    store.stopSweeper()
  })

  it('does not evict a session touched within the idle window', () => {
    const { session, getDisposeCalls } = makeFakeSession()
    store.set('recent-convo', session)

    const evicted = store.evictIdleSessions(60_000)

    expect(evicted).toBe(0)
    expect(store.has('recent-convo')).toBe(true)
    expect(getDisposeCalls()).toBe(0)
  })

  it('evicts and disposes a session idle past the threshold', async () => {
    const { session, getDisposeCalls } = makeFakeSession()
    store.set('stale-convo', session)

    // maxIdleMs=0 treats "touched just now" as already past the window —
    // avoids depending on real elapsed wall-clock time in a unit test.
    const evicted = store.evictIdleSessions(0)
    // dispose() is fire-and-forget inside evictIdleSessions — give its
    // microtask a turn before asserting the call landed.
    await Promise.resolve()

    expect(evicted).toBe(1)
    expect(store.has('stale-convo')).toBe(false)
    expect(getDisposeCalls()).toBe(1)
  })

  it('does not evict a session with an actively running turn, even if idle', () => {
    const { session, getDisposeCalls } = makeFakeSession()
    store.set('active-convo', session)
    const turn = conversationTurnRegistry.register('active-convo')

    try {
      const evicted = store.evictIdleSessions(0)

      expect(evicted).toBe(0)
      expect(store.has('active-convo')).toBe(true)
      expect(getDisposeCalls()).toBe(0)
    } finally {
      conversationTurnRegistry.complete(turn.turnId, 'done')
    }
  })

  it('re-touching a session on get() resets its idle clock', async () => {
    const { session, getDisposeCalls } = makeFakeSession()
    store.set('touched-convo', session)

    await new Promise((r) => setTimeout(r, 40))
    store.get('touched-convo') // should push touchedAt forward to ~now

    // A 25ms idle window is well past the *original* set() touch (40ms
    // ago) but should not be past the get()-refreshed one (~0ms ago) —
    // proves get() actually updates touchedAt rather than being a no-op.
    const evicted = store.evictIdleSessions(25)

    expect(evicted).toBe(0)
    expect(store.has('touched-convo')).toBe(true)
    expect(getDisposeCalls()).toBe(0)
  })

  it('remove() and delete() also drop eviction metadata (no leak via meta map)', async () => {
    const { session: s1 } = makeFakeSession()
    store.set('removed-convo', s1)
    store.remove('removed-convo')

    // A stale meta entry with no matching session would be silently
    // skipped by evictIdleSessions' `for (const [key, session] of
    // this.sessions)` loop anyway (it iterates sessions, not meta) — this
    // test guards against a future refactor that iterates meta instead.
    expect(store.evictIdleSessions(0)).toBe(0)
  })

  it('calls onBeforeEvict so a scheduled task hidden page gets closed on eviction', () => {
    const calls: Array<{
      conversationId: string
      hiddenPageId: number | undefined
    }> = []
    const storeWithHook = new SessionStore({
      onBeforeEvict: (session, conversationId) => {
        calls.push({ conversationId, hiddenPageId: session.hiddenPageId })
      },
    })
    const { session } = makeFakeSession()
    session.hiddenPageId = 42
    storeWithHook.set('hidden-page-convo', session)

    storeWithHook.evictIdleSessions(0)

    expect(calls).toEqual([
      { conversationId: 'hidden-page-convo', hiddenPageId: 42 },
    ])
    storeWithHook.stopSweeper()
  })

  it('does not clear the persist lock on eviction, so a still-in-flight write is still awaited', async () => {
    // White-box: asserts on the private persistLocks map directly, because
    // driving this race through the public persistMessages() API would
    // require injecting an artificial delay into a real SQLite write with
    // no existing seam to do that. The behavior under test — the lock
    // entry survives eviction — is exactly what the fix changed, so
    // reaching into the field is the most direct way to pin it down.
    interface SessionStoreInternals {
      persistLocks: Map<string, Promise<void>>
    }
    const { session } = makeFakeSession()
    store.set('in-flight-write-convo', session)

    // Simulate a persistMessages() call that's still running when the
    // sweep fires — evictIdleSessions must not clear persistLocks, or a
    // later persistMessages() for the same conversationId would race it
    // instead of queueing behind it (see the comment at the deletion site
    // for the full failure mode this guards against).
    let releaseFirstWrite!: () => void
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve
    })
    const internals = store as unknown as SessionStoreInternals
    internals.persistLocks.set('in-flight-write-convo', firstWriteGate)

    store.evictIdleSessions(0)

    expect(internals.persistLocks.has('in-flight-write-convo')).toBe(true)
    expect(internals.persistLocks.get('in-flight-write-convo')).toBe(
      firstWriteGate,
    )
    releaseFirstWrite()
    await firstWriteGate
  })
})

describe('ToolOutputStore', () => {
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

  it('stores and retrieves JSON tool output by toolCallId', () => {
    const store = new ToolOutputStore()
    expect(store.store('s1', 'call-1', '{"ok":true}')).toBe(true)
    expect(store.get('call-1')).toEqual({
      data: '{"ok":true}',
      mimeType: 'application/json',
    })
  })

  it('SessionStore.outputStore is a shared ToolOutputStore instance', () => {
    const sessionStore = new SessionStore()
    expect(sessionStore.outputStore).toBeInstanceOf(ToolOutputStore)
  })
})
