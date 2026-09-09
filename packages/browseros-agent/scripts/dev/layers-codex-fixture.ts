/** Responses transport fixture; calls only the disposable loopback model API. */
export async function codexFixtureResponse(
  origin: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  const input = body.input as Array<{
    type?: string
    role?: string
    output?: string
    content?: string | Array<{ text?: string }>
  }>
  const messages = input.flatMap((item) => {
    if (item.type === 'function_call_output')
      return [{ role: 'tool', content: item.output ?? '' }]
    if (item.role !== 'user') return []
    const content =
      typeof item.content === 'string'
        ? item.content
        : (item.content ?? []).map((part) => part.text ?? '').join('\n')
    try {
      return JSON.parse(content).input ? [{ role: 'user', content }] : []
    } catch {
      return []
    }
  })
  const namespaces = body.tools as Array<{
    name: string
    tools: Array<{ name: string }>
  }>
  if (namespaces.length !== 1 || namespaces[0].name !== 'mcp__pane_layer')
    throw new Error('Unexpected model tool inventory')
  const tools = namespaces[0].tools.map(({ name }) => ({ function: { name } }))
  const converted = await fetch(`${origin}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, tools }),
    signal,
  })
  const result = (await converted.json()) as {
    choices: Array<{
      message: {
        tool_calls: Array<{ function: { name: string; arguments: string } }>
      }
    }>
  }
  const call = result.choices[0].message.tool_calls[0].function
  const id = crypto.randomUUID()
  const item = {
    id: `fc_${id}`,
    call_id: `call_${id}`,
    type: 'function_call',
    namespace: 'mcp__pane_layer',
    name: call.name,
    arguments: call.arguments,
    status: 'completed',
  }
  const response = {
    id: `resp_${id}`,
    object: 'response',
    created_at: 1,
    model: body.model,
    status: 'completed',
    output: [item],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  }
  return new Response(
    [
      {
        type: 'response.created',
        response: { ...response, status: 'in_progress', output: [] },
      },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...item, status: 'in_progress', arguments: '' },
      },
      {
        type: 'response.function_call_arguments.delta',
        item_id: item.id,
        output_index: 0,
        delta: call.arguments,
      },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  )
}
