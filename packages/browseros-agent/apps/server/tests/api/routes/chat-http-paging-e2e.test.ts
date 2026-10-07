/**
 * HTTP-level e2e for chat paging + tool-outputs against an in-process Hono app.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { Hono } from 'hono'
import {
  insertRunningChatTurn,
  markChatTurnTerminal,
} from '../../../src/agent/chat-turns-store'
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

  it('loads exact tool inputs and results on demand from durable history, scoped to the chat', async () => {
    const conversationId = crypto.randomUUID()
    const input = { path: 'report.md', content: 'Full input\n'.repeat(20_000) }
    const output = {
      content: [{ type: 'text', text: 'Full output\n'.repeat(20_000) }],
    }
    const messages = [
      {
        id: 'answer',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'write',
            toolCallId: 'large-tool',
            state: 'output-available',
            input,
            output,
          },
          {
            type: 'text',
            text: '## Complete answer\n\n*r/samsung (285 comments)*\n\nThe conclusion.',
          },
        ],
      },
    ] as UIMessage[]
    await sessionStore.persistMessages(conversationId, messages, {
      syncIndexes: false,
    })
    const previewResponse = await app.request(
      `/chat/${conversationId}/messages`,
    )
    expect(previewResponse.status).toBe(200)
    const preview = (await previewResponse.json()) as { messages: UIMessage[] }
    expect(preview.messages[0].parts.at(-1)).toEqual(messages[0].parts.at(-1))
    expect(JSON.stringify(preview).length).toBeLessThan(20_000)
    // A fresh store simulates a restart: full details do not depend on renderer
    // memory or the temporary output cache.
    expect(
      new SessionStore().loadToolDetails(conversationId, 'large-tool')?.input,
    ).toEqual(input)
    const response = await app.request(
      `/chat/${conversationId}/tool-details/large-tool`,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ input, output })
    const wrongChat = await app.request(
      `/chat/${crypto.randomUUID()}/tool-details/large-tool`,
    )
    expect(wrongChat.status).toBe(404)
    const missing = await app.request(
      `/chat/${conversationId}/tool-details/missing`,
    )
    expect(missing.status).toBe(404)
    expect(await sessionStore.loadMessages(conversationId)).toEqual(messages)
  })

  it('does not pass an imported preview off as full approval parameters', async () => {
    const conversationId = crypto.randomUUID()
    const messages = [
      {
        id: 'preview',
        role: 'assistant',
        parts: [
          {
            type: 'tool-write',
            toolCallId: 'preview-call',
            state: 'approval-requested',
            input: { content: 'Preview…' },
            inputPreviewed: true,
            approval: { id: 'approval' },
          },
        ],
      },
    ] as UIMessage[]
    await sessionStore.persistMessages(conversationId, messages, {
      syncIndexes: false,
    })
    const response = await app.request(
      `/chat/${conversationId}/tool-details/preview-call`,
    )
    expect(response.status).toBe(409)
  })

  it('bounds message snapshots and pages exact overflow content without mutating history', async () => {
    const conversationId = crypto.randomUUID()
    const text = 'First page\n' + '漢😀'.repeat(80_000) + '\nEXACT END'
    const answer =
      '## Galaxy S25 Ultra\n\n*r/samsung (285 comments)*\n\nA complete conclusion.'
    const messages = [
      {
        id: 'long-message',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'reasoning '.repeat(200_000) },
          ...Array.from({ length: 500 }, (_, index) => ({
            type: 'tool-read',
            toolCallId: `read-${index}`,
            state: 'output-available',
            input: {},
            output: 'x'.repeat(2000),
          })),
          { type: 'text', text },
          { type: 'text', text: answer },
        ],
      },
    ] as UIMessage[]
    await sessionStore.persistMessages(conversationId, messages, {
      syncIndexes: false,
    })
    const snapshot = await app.request(`/chat/${conversationId}/messages`)
    const snapshotText = await snapshot.text()
    expect(Buffer.byteLength(snapshotText)).toBeLessThan(1_000_000)
    const projected = JSON.parse(snapshotText) as { messages: UIMessage[] }
    expect(projected.messages[0].parts.length).toBeLessThanOrEqual(128)
    expect(
      projected.messages[0].parts.some(
        (part) => part.type === 'text' && part.text === answer,
      ),
    ).toBe(true)
    const url = `/chat/${conversationId}/message-content/long-message`
    const defaultPage = (await (await app.request(url)).json()) as {
      part: { text: string }
      index: number
    }
    expect(defaultPage.part.text).toBe(answer)
    expect(defaultPage.index).toBe(502)
    let cursor: { part: number; offset: number } | null = {
      part: 501,
      offset: 0,
    }
    let restored = ''
    while (cursor?.part === 501) {
      const response = await app.request(
        `${url}?part=${cursor.part}&offset=${cursor.offset}`,
      )
      const body = await response.text()
      expect(Buffer.byteLength(body)).toBeLessThan(64_000)
      const page = JSON.parse(body) as {
        part: { text: string }
        next: typeof cursor
      }
      restored += page.part.text
      cursor = page.next
    }
    expect(restored === text).toBe(true)
    expect((await app.request(`${url}?part=-1`)).status).toBe(400)
    expect((await app.request(`${url}?part=999999`)).status).toBe(404)
    expect(
      (
        await app.request(
          `/chat/${crypto.randomUUID()}/message-content/long-message`,
        )
      ).status,
    ).toBe(404)
    const original = await sessionStore.loadMessageContent(
      conversationId,
      'long-message',
    )
    expect(original?.parts.length).toBe(503)
    expect((original?.parts[501] as { text: string }).text === text).toBe(true)
  })

  it('replays durable completion after the live stream has expired', async () => {
    const conversationId = crypto.randomUUID()
    await sessionStore.persistMessages(
      conversationId,
      [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      { syncIndexes: false },
    )
    const turnId = crypto.randomUUID()
    await insertRunningChatTurn({
      turnId,
      sessionId: conversationId,
      startedAt: Date.now(),
    })
    await markChatTurnTerminal({ turnId, status: 'done' })
    const response = await app.request(
      `/chat/${conversationId}/stream?turnId=${turnId}`,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toContain('"status":"done"')
    const wrongChat = await app.request(
      `/chat/${crypto.randomUUID()}/stream?turnId=${turnId}`,
    )
    expect(wrongChat.status).toBe(404)
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
    const toolCallId = (asst?.parts[0] as { toolCallId: string }).toolCallId
    const out = (asst?.parts[0] as { output: { spilled?: boolean } }).output
    expect(out.spilled).toBe(true)

    const olderRes = await app.request(
      `/chat/${conversationId}/messages?limit=10&beforeId=${page.messages[0]?.id}`,
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
