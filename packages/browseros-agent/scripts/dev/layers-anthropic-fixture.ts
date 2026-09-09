/** Translate the deterministic OpenAI-format test fixture to Claude's wire
 * protocol. No production endpoint, account, or credential is used here. */
export function anthropicFixtureResponse(
  model: string,
  content:
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown },
) {
  const isTool = content.type === 'tool_use'
  const message = {
    id: 'fixture',
    type: 'message',
    role: 'assistant',
    model,
    content: [content],
    stop_reason: isTool ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 40 },
  }
  const events = [
    [
      'message_start',
      {
        type: 'message_start',
        message: {
          ...message,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 20, output_tokens: 0 },
        },
      },
    ],
    [
      'content_block_start',
      {
        type: 'content_block_start',
        index: 0,
        content_block: isTool
          ? { ...content, input: {} }
          : { type: 'text', text: '' },
      },
    ],
    [
      'content_block_delta',
      {
        type: 'content_block_delta',
        index: 0,
        delta: isTool
          ? {
              type: 'input_json_delta',
              partial_json: JSON.stringify(content.input),
            }
          : { type: 'text_delta', text: content.text },
      },
    ],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage: { output_tokens: 40 },
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  ]
    .map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('')
  return new Response(events, {
    headers: { 'content-type': 'text/event-stream' },
  })
}
