/**
 * ChatService-level e2e: projected getConversation + paged listMessages.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { SessionStore } from '../../../src/agent/session-store'
import { ChatService } from '../../../src/api/services/chat-service'
import { closeDb, initializeDb } from '../../../src/lib/db'

function makeTmpDb() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'chat-service-page-e2e-'))
  return { tmpDir, dbPath: join(tmpDir, 'test.db') }
}

describe('ChatService listConversationMessages + projection', () => {
  let tmpDir: string
  let sessionStore: SessionStore
  let service: ChatService

  beforeEach(() => {
    const t = makeTmpDb()
    tmpDir = t.tmpDir
    initializeDb({ dbPath: t.dbPath, runMigrations: true })
    sessionStore = new SessionStore()
    service = new ChatService({
      sessionStore,
      browser: {} as never,
      browserSession: {} as never,
      serverPort: 0,
    })
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('getConversation returns UI-projected messages and list pages correctly', async () => {
    const conversationId = crypto.randomUUID()
    const fat = 'X'.repeat(12_000)
    const messages: UIMessage[] = []
    for (let i = 0; i < 40; i++) {
      if (i % 2 === 0) {
        messages.push({
          id: `u${i}`,
          role: 'user',
          parts: [{ type: 'text', text: `user-${i}` }],
        })
      } else {
        messages.push({
          id: `a${i}`,
          role: 'assistant',
          parts: [
            {
              type: 'tool-navigate',
              toolCallId: `call-${i}`,
              state: 'output-available',
              input: { url: 'https://example.com' },
              output: { content: [{ type: 'text', text: fat }] },
            } as never,
          ],
        })
      }
    }
    await sessionStore.persistMessages(conversationId, messages, {
      syncIndexes: false,
    })

    const detail = await service.getConversation(conversationId)
    expect(detail).not.toBeNull()
    expect(detail!.messages.length).toBe(40)
    // UI projection should shrink assistant tool bodies
    const firstAssistant = detail!.messages.find((m) => m.role === 'assistant')
    const part = firstAssistant?.parts[0] as {
      output?: { spilled?: boolean; content?: Array<{ text?: string }> }
    }
    expect(part.output?.spilled).toBe(true)
    expect((part.output?.content?.[0]?.text ?? '').length).toBeLessThan(
      fat.length,
    )

    // Agent/persisted transcript still fat
    const loaded = await sessionStore.loadMessages(conversationId)
    const loadedPart = loaded.find((m) => m.role === 'assistant')?.parts[0] as {
      output: { content: Array<{ text: string }> }
    }
    expect(loadedPart.output.content[0].text.length).toBe(fat.length)

    const page = await service.listConversationMessages(conversationId, {
      limit: 10,
    })
    expect(page).not.toBeNull()
    expect(page!.messages).toHaveLength(10)
    expect(page!.hasMore).toBe(true)
    expect(page!.messages[0]?.id).toBe('u30')

    const older = await service.listConversationMessages(conversationId, {
      beforeId: page!.messages[0]!.id,
      limit: 10,
    })
    expect(older!.messages).toHaveLength(10)
    expect(older!.hasMore).toBe(true)
    expect(older!.messages.at(-1)?.id).toBe('a29')

    // Spilled output available for expand
    const toolCallId = (firstAssistant!.parts[0] as { toolCallId: string })
      .toolCallId
    const spilled = sessionStore.outputStore.get(toolCallId)
    expect(spilled?.data).toContain(fat)
  })
})
