/**
 * Live SSE projection + empty-continue recovery — the two failure modes
 * behind extension V8 OOM mid-turn and silent "continue" no-ops.
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
import { SessionStore } from '../../src/agent/session-store'
import { slimSseEvent } from '../../src/agent/slim-ui-sse-stream'
import { closeDb, initializeDb } from '../../src/lib/db'

describe('slimSseEvent (live POST SSE client branch)', () => {
  let tmpDir: string
  let store: SessionStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'slim-sse-'))
    initializeDb({ dbPath: join(tmpDir, 'test.db'), runMigrations: true })
    store = new SessionStore()
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('spills fat tool-output-available payloads so SSE stays small', () => {
    const sessionId = crypto.randomUUID()
    const fat = 'Z'.repeat(20_000)
    const event = `data: ${JSON.stringify({
      type: 'tool-output-available',
      toolCallId: 'call-fat',
      output: {
        content: [{ type: 'text', text: fat }],
      },
    })}`

    const slimmed = slimSseEvent(event, {
      sessionId,
      outputStore: store.outputStore,
    })
    expect(slimmed.length).toBeLessThan(event.length / 2)
    expect(slimmed.length).toBeLessThan(6_000)
    const payload = JSON.parse(slimmed.replace(/^data:\s*/, '')) as {
      output: { spilled?: boolean; preview?: string }
    }
    expect(payload.output.spilled).toBe(true)
    expect(payload.output.preview?.length).toBeLessThan(fat.length)
    expect(store.outputStore.get('call-fat')?.data).toContain(fat)
  })

  it('leaves small tool outputs and non-tool events alone', () => {
    const sessionId = crypto.randomUUID()
    const small = `data: ${JSON.stringify({
      type: 'tool-output-available',
      toolCallId: 'call-small',
      output: { content: [{ type: 'text', text: 'ok' }] },
    })}`
    expect(
      slimSseEvent(small, {
        sessionId,
        outputStore: store.outputStore,
      }),
    ).toBe(small)

    const text = `data: ${JSON.stringify({ type: 'text-delta', delta: 'hi' })}`
    expect(
      slimSseEvent(text, {
        sessionId,
        outputStore: store.outputStore,
      }),
    ).toBe(text)
  })
})

describe('empty continue recovery (dogfood failure class)', () => {
  it('empty finish survives filterValidMessages so a later continue is not a no-op', () => {
    // Repro: turn finishes with parts:[], filterValidMessages drops assistant,
    // transcript ends on user "continue", next identical continue looks empty.
    const messages: UIMessage[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'continue' }],
      },
      { id: 'a1', role: 'assistant', parts: [] },
    ]

    const withoutFix = filterValidMessages(messages)
    expect(withoutFix.map((m) => m.id)).toEqual(['u1'])
    expect(withoutFix.at(-1)?.role).toBe('user')

    const filled = ensureNonEmptyAssistantFinish({
      messages,
      responseMessage: messages[1]!,
      isAborted: false,
    })
    expect(filled.filled).toBe(true)

    const valid = filterValidMessages(filled.messages)
    expect(valid.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(valid.at(-1)?.role).toBe('assistant')
    expect(
      (valid.at(-1)?.parts[0] as { text?: string } | undefined)?.text,
    ).toBe(EMPTY_AGENT_FINISH_MESSAGE)

    // Next "continue" can append: last role is assistant, not duplicate user.
    const last = valid.at(-1)!
    expect(last.role).not.toBe('user')
  })
})
