/**
 * HTTP-level e2e for chat paging + tool-outputs against an in-process Hono app.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { Hono } from 'hono'
import { SessionStore } from '../../../src/agent/session-store'
import { createChatRoutes } from '../../../src/api/routes/chat'
import { closeDb, initializeDb } from '../../../src/lib/db'

function makeTmpDb() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'chat-http-e2e-'))
  return { tmpDir, dbPath: join(tmpDir, 'test.db') }
}

describe('chat HTTP e2e (paging + tool-outputs)', () => {
  let tmpDir: string
  let sessionStore: SessionStore
  let app: Hono

  beforeEach(() => {
    const t = makeTmpDb()
    tmpDir = t.tmpDir
    initializeDb({ dbPath: t.dbPath, runMigrations: true })
    sessionStore = new SessionStore()
    app = new Hono().route(
      '/chat',
      createChatRoutes({
        sessionStore,
        browser: {} as never,
        browserSession: {} as never,
        serverPort: 0,
      }),
    )
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('GET messages pages and tool-outputs returns spilled body', async () => {
    const conversationId = crypto.randomUUID()
    const fat = 'HTTPFAT'.repeat(2_000)
    const messages: UIMessage[] = []
    for (let i = 0; i < 35; i++) {
      messages.push({
        id: `id-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        parts:
          i % 2 === 0
            ? [{ type: 'text', text: `u-${i}` }]
            : [
                {
                  type: 'tool-navigate',
                  toolCallId: `call-${i}`,
                  state: 'output-available',
                  input: {},
                  output: { content: [{ type: 'text', text: fat }] },
                } as never,
              ],
      })
    }
    await sessionStore.persistMessages(conversationId, messages, {
      syncIndexes: false,
    })

    const pageRes = await app.request(
      `/chat/${conversationId}/messages?limit=10`,
    )
    expect(pageRes.status).toBe(200)
    const page = (await pageRes.json()) as {
      messages: UIMessage[]
      hasMore: boolean
    }
    expect(page.messages).toHaveLength(10)
    expect(page.hasMore).toBe(true)

    // Projection happens on getConversation inside list — spilled stubs
    const asst = page.messages.find((m) => m.role === 'assistant')
    expect(asst).toBeTruthy()
    const toolCallId = (asst!.parts[0] as { toolCallId: string }).toolCallId
    const out = (asst!.parts[0] as { output: { spilled?: boolean } }).output
    expect(out.spilled).toBe(true)

    const olderRes = await app.request(
      `/chat/${conversationId}/messages?limit=10&beforeId=${page.messages[0]!.id}`,
    )
    expect(olderRes.status).toBe(200)
    const older = (await olderRes.json()) as { messages: UIMessage[] }
    expect(older.messages).toHaveLength(10)

    const toolRes = await app.request(
      `/chat/${conversationId}/tool-outputs/${toolCallId}`,
    )
    expect(toolRes.status).toBe(200)
    const body = await toolRes.text()
    expect(body).toContain(fat)
  })
})
