import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { eq } from 'drizzle-orm'
import { SessionStore } from '../../src/agent/session-store'
import { closeDb, getDb, initializeDb } from '../../src/lib/db'
import { chatSessions } from '../../src/lib/db/schema/chat-sessions'

describe('SessionStore Persistence', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browseros-test-db-'))
    dbPath = join(tmpDir, 'test.db')
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
})
