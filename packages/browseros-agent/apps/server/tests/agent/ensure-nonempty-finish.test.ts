import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  EMPTY_AGENT_FINISH_MESSAGE,
  ensureNonEmptyAssistantFinish,
} from '../../src/agent/durable-agent-ui-stream'

describe('ensureNonEmptyAssistantFinish', () => {
  it('fills empty non-aborted assistant so it survives filterValidMessages', () => {
    const responseMessage: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [],
    }
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'continue' }] },
      responseMessage,
    ]
    const result = ensureNonEmptyAssistantFinish({
      messages,
      responseMessage,
      isAborted: false,
      errorText: 'provider blew up',
      finishReason: 'error',
    })
    expect(result.filled).toBe(true)
    expect(result.responseMessage.parts).toEqual([
      { type: 'text', text: 'provider blew up' },
    ])
    expect(result.messages.at(-1)?.parts[0]).toEqual({
      type: 'text',
      text: 'provider blew up',
    })
  })

  it('uses default recovery copy when no stream error was captured', () => {
    const responseMessage: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [],
    }
    const result = ensureNonEmptyAssistantFinish({
      messages: [responseMessage],
      responseMessage,
      isAborted: false,
    })
    expect(result.filled).toBe(true)
    expect(result.responseMessage.parts[0]).toEqual({
      type: 'text',
      text: EMPTY_AGENT_FINISH_MESSAGE,
    })
  })

  it('does not modify aborted or non-empty finishes', () => {
    const empty: UIMessage = { id: 'a1', role: 'assistant', parts: [] }
    expect(
      ensureNonEmptyAssistantFinish({
        messages: [empty],
        responseMessage: empty,
        isAborted: true,
      }).filled,
    ).toBe(false)

    const ok: UIMessage = {
      id: 'a2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'done' }],
    }
    expect(
      ensureNonEmptyAssistantFinish({
        messages: [ok],
        responseMessage: ok,
        isAborted: false,
      }).filled,
    ).toBe(false)
  })
})
