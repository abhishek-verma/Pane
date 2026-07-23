/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { transformCerebrasRequestBody } from '../../../../src/lib/clients/llm/cerebras'

describe('transformCerebrasRequestBody', () => {
  it('renames assistant reasoning_content to reasoning', () => {
    expect(
      transformCerebrasRequestBody({
        model: 'gpt-oss-120b',
        messages: [
          { role: 'user', content: 'what is the magic number?' },
          {
            role: 'assistant',
            content: null,
            reasoning_content: 'I should call a tool.',
            tool_calls: [
              {
                id: 'tool-call-id',
                type: 'function',
                function: { name: 'getNumber', arguments: '{}' },
              },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'tool-call-id',
            content: '2026',
          },
        ],
      }),
    ).toEqual({
      model: 'gpt-oss-120b',
      messages: [
        { role: 'user', content: 'what is the magic number?' },
        {
          role: 'assistant',
          content: null,
          reasoning: 'I should call a tool.',
          tool_calls: [
            {
              id: 'tool-call-id',
              type: 'function',
              function: { name: 'getNumber', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'tool-call-id',
          content: '2026',
        },
      ],
    })
  })

  it('leaves messages without reasoning_content unchanged', () => {
    const body = {
      model: 'gpt-oss-120b',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    }
    expect(transformCerebrasRequestBody(body)).toEqual(body)
  })

  it('does not overwrite an existing reasoning field', () => {
    expect(
      transformCerebrasRequestBody({
        messages: [
          {
            role: 'assistant',
            content: 'done',
            reasoning: 'kept',
            reasoning_content: 'ignored',
          },
        ],
      }),
    ).toEqual({
      messages: [
        {
          role: 'assistant',
          content: 'done',
          reasoning: 'kept',
        },
      ],
    })
  })
})
