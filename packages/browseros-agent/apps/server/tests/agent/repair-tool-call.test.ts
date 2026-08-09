/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, mock } from 'bun:test'
import { InvalidToolInputError, NoSuchToolError } from 'ai'
import { createRepairToolCall } from '../../src/agent/repair-tool-call'

function makeToolCall(input: string) {
  return {
    toolCallId: 'call_1',
    toolName: 'pi_page_patch',
    input,
  } as const
}

describe('createRepairToolCall', () => {
  it('returns null immediately for NoSuchToolError (not repairable)', async () => {
    const generateText = mock(async () => ({ text: '{}' }))
    const repair = createRepairToolCall({ generateText: generateText as never })
    const result = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall('{"pageId":'),
      tools: {},
      inputSchema: async () => ({ type: 'object' }) as never,
      error: new NoSuchToolError({ toolName: 'nope', availableTools: [] }),
    })
    expect(result).toBeNull()
    expect(generateText).not.toHaveBeenCalled()
  })

  it('re-asks the model and returns a repaired tool call on valid JSON', async () => {
    const generateText = mock(async () => ({
      text: '{"pageId":"page_1","ops":[{"op":"setTitle","title":"Fixed"}]}',
    }))
    const repair = createRepairToolCall({ generateText: generateText as never })
    const brokenInput =
      '{"pageId":"page_1","ops":[{"op":"setTitle","title":"Fixed"'
    const result = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall(brokenInput),
      tools: {},
      inputSchema: async () => ({ type: 'object' }) as never,
      error: new InvalidToolInputError({
        toolName: 'pi_page_patch',
        toolInput: brokenInput,
        cause: new Error("JSON Parse error: Expected ']'"),
      }),
    })
    expect(result).not.toBeNull()
    expect(result?.toolCallId).toBe('call_1')
    expect(result?.toolName).toBe('pi_page_patch')
    expect(JSON.parse(result?.input as string)).toEqual({
      pageId: 'page_1',
      ops: [{ op: 'setTitle', title: 'Fixed' }],
    })
  })

  it('returns null when the re-ask also produces invalid JSON', async () => {
    const generateText = mock(async () => ({ text: 'still not json' }))
    const repair = createRepairToolCall({ generateText: generateText as never })
    const result = await repair({
      system: undefined,
      messages: [],
      toolCall: makeToolCall('{"broken'),
      tools: {},
      inputSchema: async () => ({ type: 'object' }) as never,
      error: new InvalidToolInputError({
        toolName: 'pi_page_patch',
        toolInput: '{"broken',
        cause: new Error('JSON Parse error'),
      }),
    })
    expect(result).toBeNull()
  })
})
