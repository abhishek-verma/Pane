/**
 * SessionStore.loadMessagesPage: true SQL cursor paging (not load-all-then-slice).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { SessionStore } from '../../src/agent/session-store'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('SessionStore.loadMessagesPage', () => {
  let tmpDir: string
  let store: SessionStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-page-'))
    initializeDb({ dbPath: join(tmpDir, 'test.db'), runMigrations: true })
    store = new SessionStore()
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('pages newest-first without requiring a full transcript load', async () => {
    const sessionId = crypto.randomUUID()
    const messages: UIMessage[] = []
    for (let i = 0; i < 25; i++) {
      messages.push({
        id: `m${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        parts: [{ type: 'text', text: `msg-${i}` }],
      })
    }
    await store.persistMessages(sessionId, messages)

    const newest = await store.loadMessagesPage(sessionId, { limit: 10 })
    expect(newest.messages).toHaveLength(10)
    expect(newest.hasMore).toBe(true)
    expect(newest.messages[0]?.id).toBe('m15')
    expect(newest.messages.at(-1)?.id).toBe('m24')

    const older = await store.loadMessagesPage(sessionId, {
      beforeId: newest.messages[0]?.id,
      limit: 10,
    })
    expect(older.messages).toHaveLength(10)
    expect(older.hasMore).toBe(true)
    expect(older.messages[0]?.id).toBe('m5')
    expect(older.messages.at(-1)?.id).toBe('m14')

    const oldest = await store.loadMessagesPage(sessionId, {
      beforeId: older.messages[0]?.id,
      limit: 10,
    })
    expect(oldest.messages).toHaveLength(5)
    expect(oldest.hasMore).toBe(false)
    expect(oldest.messages[0]?.id).toBe('m0')
  })
})
