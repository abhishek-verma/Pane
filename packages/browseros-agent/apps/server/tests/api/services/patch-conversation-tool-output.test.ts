/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { SessionStore } from '../../../src/agent/session-store'
import { patchConversationToolOutput } from '../../../src/api/services/patch-conversation-tool-output'
import { closeDb, initializeDb } from '../../../src/lib/db'

describe('patchConversationToolOutput', () => {
  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), 'pane-patch-tool-'))
    closeDb()
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  })

  afterEach(() => {
    closeDb()
  })

  it('persists promoted tool output into SQLite transcript', async () => {
    const store = new SessionStore()
    const conversationId = crypto.randomUUID()
    const toolCallId = 'call_promote_1'
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'run echo' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-filesystem_bash',
            toolCallId,
            toolName: 'filesystem_bash',
            state: 'output-available',
            input: { command: 'echo hi' },
            output: {
              text: 'Dry-run. Command:\n\n$ echo hi\n\nRe-call with __promoted:true to run.',
            },
          } as UIMessage['parts'][number],
        ],
      },
    ]

    await store.persistMessages(conversationId, messages)

    const patched = await patchConversationToolOutput(
      store,
      conversationId,
      toolCallId,
      'filesystem_bash',
      { text: 'hi\n', isError: false },
      false,
    )
    expect(patched).toBe(true)

    const loaded = await store.loadMessages(conversationId)
    const toolPart = loaded[1]?.parts.find(
      (p) =>
        typeof p.type === 'string' &&
        p.type.startsWith('tool-') &&
        (p as { toolCallId?: string }).toolCallId === toolCallId,
    ) as { output?: { text?: string }; state?: string } | undefined

    expect(toolPart?.state).toBe('output-available')
    expect(toolPart?.output?.text).toContain('hi')
    expect(toolPart?.output?.text).not.toContain('Dry-run')
  })
})
