/**
 * End-to-end coverage for scalable chat memory: projection, paging,
 * empty-finish recovery, and agent-fidelity invariant.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import {
  EMPTY_AGENT_FINISH_MESSAGE,
  ensureNonEmptyAssistantFinish,
} from '../../src/agent/durable-agent-ui-stream'
import { filterValidMessages } from '../../src/agent/message-validation'
import { projectMessagesForUi } from '../../src/agent/project-messages-for-ui'
import { SessionStore } from '../../src/agent/session-store'
import { closeDb, initializeDb } from '../../src/lib/db'

function makeTmpDb() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'scalable-chat-e2e-'))
  return { tmpDir, dbPath: join(tmpDir, 'test.db') }
}

function fatAssistant(id: string, toolCallId: string, text: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [
      {
        type: 'tool-navigate',
        toolCallId,
        state: 'output-available',
        input: { url: 'https://example.com' },
        output: { content: [{ type: 'text', text }] },
      } as never,
    ],
  }
}

describe('scalable chat memory e2e', () => {
  let tmpDir: string
  let store: SessionStore

  beforeEach(() => {
    const t = makeTmpDb()
    tmpDir = t.tmpDir
    initializeDb({ dbPath: t.dbPath, runMigrations: true })
    store = new SessionStore()
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keeps agent transcript fat while UI projection is slim and reloadable', () => {
    const conversationId = crypto.randomUUID()
    const fat = 'PAGE'.repeat(5_000)
    const agentMessages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'research' }],
      },
      fatAssistant('a1', 'call-fat', fat),
    ]

    const projected = projectMessagesForUi(agentMessages, {
      sessionId: conversationId,
      outputStore: store.outputStore,
      previewMaxChars: 200,
    })

    // Agent fidelity invariant
    const agentText = (
      agentMessages[1].parts[0] as {
        output: { content: Array<{ text: string }> }
      }
    ).output.content[0].text
    expect(agentText).toBe(fat)

    const uiPart = projected[1].parts[0] as {
      output: {
        spilled?: boolean
        preview?: string
        content: Array<{ text: string }>
      }
    }
    expect(uiPart.output.spilled).toBe(true)
    expect(uiPart.output.content[0].text.length).toBeLessThan(fat.length)
    expect(JSON.stringify(projected).length).toBeLessThan(
      JSON.stringify(agentMessages).length,
    )

    const stored = store.outputStore.get('call-fat')
    expect(stored).not.toBeNull()
    expect(stored?.data).toContain(fat)
  })

  it('pages newest messages and reports hasMore for Cursor-style scroll', async () => {
    const conversationId = crypto.randomUUID()
    const messages: UIMessage[] = []
    for (let i = 0; i < 45; i++) {
      messages.push({
        id: `m${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        parts: [{ type: 'text', text: `msg-${i}` }],
      })
    }
    await store.persistMessages(conversationId, messages, {
      syncIndexes: false,
    })

    const loaded = await store.loadMessages(conversationId)
    expect(loaded.length).toBe(45)

    const limit = 30
    const end = loaded.length
    const start = end - limit
    const page = loaded.slice(start, end)
    expect(page).toHaveLength(30)
    expect(page[0]?.id).toBe('m15')
    expect(page.at(-1)?.id).toBe('m44')
    expect(start > 0).toBe(true)

    const olderEnd = start
    const olderStart = Math.max(0, olderEnd - limit)
    const older = loaded.slice(olderStart, olderEnd)
    expect(older[0]?.id).toBe('m0')
    expect(older.at(-1)?.id).toBe('m14')
  })

  it('empty finish becomes a persistable recovery message', () => {
    const empty: UIMessage = { id: 'a-empty', role: 'assistant', parts: [] }
    const filled = ensureNonEmptyAssistantFinish({
      messages: [
        { id: 'u', role: 'user', parts: [{ type: 'text', text: 'continue' }] },
        empty,
      ],
      responseMessage: empty,
      isAborted: false,
    })
    expect(filled.filled).toBe(true)
    const valid = filterValidMessages(filled.messages)
    expect(valid.some((m) => m.id === 'a-empty')).toBe(true)
    expect(
      (valid.find((m) => m.id === 'a-empty')?.parts[0] as { text: string })
        .text,
    ).toBe(EMPTY_AGENT_FINISH_MESSAGE)
  })
})
