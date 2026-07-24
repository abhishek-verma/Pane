import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getDbRunningChatTurn,
  insertRunningChatTurn,
  reconcileStaleChatTurns,
} from '../../src/agent/chat-turns-store'
import { closeDb, getDb, initializeDb } from '../../src/lib/db'
import { chatSessions } from '../../src/lib/db/schema/chat-sessions'

describe('chat_turns durable mirror', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browseros-chat-turns-'))
    initializeDb({ dbPath: join(tmpDir, 'test.db'), runMigrations: true })
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('boot reconcile marks running rows interrupted', async () => {
    const sessionId = crypto.randomUUID()
    await getDb().insert(chatSessions).values({
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const turnId = crypto.randomUUID()
    await insertRunningChatTurn({
      turnId,
      sessionId,
      startedAt: Date.now(),
    })
    expect(await getDbRunningChatTurn(sessionId)).not.toBeNull()

    const changes = reconcileStaleChatTurns()
    expect(changes).toBe(1)
    expect(await getDbRunningChatTurn(sessionId)).toBeNull()
  })
})
