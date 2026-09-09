import { randomBytes } from 'node:crypto'

export interface CodexTransportPolicy {
  model: string
  tools: ReadonlySet<string>
  maxRequests: number
  maxOutputTokens: number
  /** False limits accepted output, not provider generation or spending. */
  providerOutputCeiling?: boolean
  signal: AbortSignal
  current: () => boolean
  /** Native auth stays in Authorization; the invocation secret uses a separate
   * header so the CLI can keep its configured account and refresh behavior. */
  nativeAuth?: boolean
  instructions?: string
  observeTools?: (tools: Array<{ type?: unknown; name?: unknown }>) => void
  observeFailure?: (failure: {
    stage: string
    status?: number
    code?: string
  }) => void
  /** Canonical private tools can be advertised eagerly even when the CLI
   * defers its MCP catalog. Tool search and provider built-ins stay absent. */
  toolDefinitions?: Array<
    | {
        type: 'function'
        name: string
        description?: string
        parameters: unknown
      }
    | {
        type: 'namespace'
        name: string
        description?: string
        tools: Array<{
          type: 'function'
          name: string
          description?: string
          parameters: unknown
        }>
      }
  >
}

/** CLI feature flags are not a tool boundary. Restrict the actual model wire
 * request, and buffer/validate every response before any tool event reaches it. */
export function restrictCodexRequest(
  raw: unknown,
  policy: CodexTransportPolicy,
) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid model request')
  const body = raw as Record<string, unknown>
  if (body.model !== policy.model) throw new Error('The saved model changed')
  if (body.stream !== true)
    throw new Error('Expected a streaming action request')
  policy.observeTools?.(
    (Array.isArray(body.tools) ? body.tools : []).map((tool) => ({
      type: tool?.type,
      name: tool?.name,
    })),
  )
  const tools = (
    policy.toolDefinitions ?? (Array.isArray(body.tools) ? body.tools : [])
  ).filter((item: unknown) => {
    if (!item || typeof item !== 'object') return false
    const tool = item as {
      type?: unknown
      name?: unknown
      tools?: Array<{ type?: string; name?: string }>
    }
    if (tool.type === 'namespace' && typeof tool.name === 'string')
      return (
        Array.isArray(tool.tools) &&
        tool.tools.length > 0 &&
        tool.tools.every(
          (entry) =>
            entry.type === 'function' &&
            policy.tools.has(`${tool.name}.${entry.name}`),
        )
      )
    return (
      tool.type === 'function' &&
      typeof tool.name === 'string' &&
      policy.tools.has(tool.name)
    )
  })
  const result = {
    ...body,
    ...(policy.instructions ? { instructions: policy.instructions } : {}),
    tools,
    tool_choice: tools.length ? 'auto' : 'none',
    parallel_tool_calls: false,
    max_output_tokens: Math.floor(policy.maxOutputTokens / policy.maxRequests),
  }
  if (policy.providerOutputCeiling === false)
    Reflect.deleteProperty(result, 'max_output_tokens')
  return result
}

const CODEX_ACTION_EVENTS = new Set([
  'response.created',
  'response.in_progress',
  'response.completed',
  'response.output_item.added',
  'response.output_item.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.output_text.annotation.added',
  'response.function_call_arguments.delta',
  'response.function_call_arguments.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.reasoning_text.delta',
  'response.reasoning_text.done',
  'response.refusal.delta',
  'response.refusal.done',
])

export function validateCodexEventStream(
  text: string,
  policy: CodexTransportPolicy,
): void {
  let completed = false
  const functionItems = new Map<string, string>()
  const inspectItem = (raw: unknown) => {
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid response item')
    const item = raw as {
      type?: unknown
      name?: unknown
      namespace?: unknown
      id?: unknown
    }
    if (item.type === 'message' || item.type === 'reasoning') return
    if (
      item.type === 'function_call' &&
      typeof item.name === 'string' &&
      policy.tools.has(
        item.namespace ? `${item.namespace}.${item.name}` : item.name,
      ) &&
      typeof item.id === 'string'
    ) {
      const name = item.namespace ? `${item.namespace}.${item.name}` : item.name
      if (functionItems.has(item.id) && functionItems.get(item.id) !== name)
        throw new Error('A function item changed its tool binding')
      functionItems.set(item.id, name)
      return
    }
    throw new Error('The model returned a forbidden tool event')
  }
  for (const block of text.replaceAll('\r\n', '\n').split('\n\n')) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') continue
    const event = JSON.parse(data) as {
      type?: string
      item?: unknown
      item_id?: string
      name?: string
      namespace?: string
      response?: {
        model?: string
        output?: unknown[]
        usage?: { output_tokens?: unknown }
      }
    }
    if (completed) throw new Error('Events followed the terminal response')
    if (!event.type || !CODEX_ACTION_EVENTS.has(event.type))
      throw new Error('Unsupported response event')
    if (
      event.type.startsWith('response.function_call_arguments.') &&
      (!event.item_id ||
        !functionItems.has(event.item_id) ||
        (event.name &&
          functionItems.get(event.item_id) !==
            (event.namespace
              ? `${event.namespace}.${event.name}`
              : event.name)))
    )
      throw new Error('Unbound function argument event')
    if (event.item) inspectItem(event.item)
    for (const item of event.response?.output ?? []) inspectItem(item)
    if (event.type === 'response.completed') {
      const usage = event.response?.usage?.output_tokens
      if (
        typeof usage !== 'number' ||
        !Number.isFinite(usage) ||
        usage < 0 ||
        usage > Math.floor(policy.maxOutputTokens / policy.maxRequests)
      )
        throw new Error('The model output exceeded its action budget')
      if (event.response?.model && event.response.model !== policy.model)
        throw new Error('The response model changed')
      completed = true
    }
  }
  if (!completed) throw new Error('No complete bounded model response')
}

export function startCodexActionTransport(
  policy: CodexTransportPolicy,
  upstream: (
    body: Record<string, unknown>,
    signal: AbortSignal,
    accountHeaders: Headers,
  ) => Promise<Response>,
) {
  if (
    !policy.model.trim() ||
    !Number.isSafeInteger(policy.maxRequests) ||
    policy.maxRequests < 1 ||
    !Number.isSafeInteger(policy.maxOutputTokens) ||
    policy.maxOutputTokens < policy.maxRequests
  )
    throw new Error('Invalid Codex action limits')
  const token = randomBytes(32).toString('hex')
  const upstreamAbort = new AbortController()
  let requests = 0,
    closed = false
  const current = () => !closed && !policy.signal.aborted && policy.current()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    maxRequestBodySize: 2 * 1024 * 1024,
    async fetch(request) {
      if (
        !current() ||
        (policy.nativeAuth
          ? request.headers.get('x-pane-layer-transport') !== token
          : request.headers.get('authorization') !== `Bearer ${token}`)
      ) {
        policy.observeFailure?.({ stage: 'invocation-auth', status: 403 })
        return Response.json(
          { error: { message: 'Layer action unavailable' } },
          { status: 403 },
        )
      }
      if (
        request.method !== 'POST' ||
        new URL(request.url).pathname !== '/v1/responses'
      )
        return new Response(null, { status: 404 })
      if (requests >= policy.maxRequests)
        return Response.json(
          { error: { message: 'Layer request budget reached' } },
          { status: 429 },
        )
      requests++
      try {
        const body = restrictCodexRequest(await request.json(), policy)
        if (!current()) throw new Error('Revoked')
        const accountHeaders = new Headers()
        if (policy.nativeAuth) {
          const authorization = request.headers.get('authorization')
          if (!authorization?.startsWith('Bearer ') || authorization.length < 8)
            throw new Error('Missing account authentication')
          accountHeaders.set('authorization', authorization)
          const account = request.headers.get('chatgpt-account-id')
          if (account) accountHeaders.set('chatgpt-account-id', account)
        }
        const response = await upstream(
          body,
          upstreamAbort.signal,
          accountHeaders,
        )
        if (!response.ok || !response.body) {
          let code: string | undefined
          if (policy.observeFailure) {
            // Diagnostic vocabulary is fixed; never log a vendor body, prompt,
            // credential or arbitrary error parameter supplied by the peer.
            const reader = response.body?.getReader()
            const decoder = new TextDecoder()
            let error = '',
              bytes = 0
            try {
              while (reader && bytes < 8192) {
                const { done, value } = await reader.read()
                if (done) break
                const part = value.subarray(0, 8192 - bytes)
                bytes += part.byteLength
                error += decoder.decode(part, { stream: true })
              }
            } finally {
              await reader?.cancel()
              reader?.releaseLock()
            }
            code =
              [
                'max_output_tokens',
                'parallel_tool_calls',
                'tool_choice',
                'namespace',
                'verbosity',
                'reasoning',
                'instructions',
                'input',
                'metadata',
                'prompt_cache_key',
                'prompt_cache_retention',
                'store',
                'temperature',
                'service_tier',
                'model',
                'stream',
                'safety_identifier',
                'tools',
                'description',
                'parameters',
                'additionalProperties',
                'required',
                'schema',
                'function',
                'type',
                'name',
              ]
                .filter((name) => error.includes(name))
                .join(',') || 'unclassified'
          }
          policy.observeFailure?.({
            stage: 'upstream',
            status: response.status,
            code,
          })
          throw new Error('Upstream unavailable')
        }
        const reader = response.body.getReader(),
          decoder = new TextDecoder()
        let text = '',
          bytes = 0
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > 2 * 1024 * 1024 || !current()) {
              await reader.cancel()
              throw new Error('Action response exceeded its boundary')
            }
            text += decoder.decode(value, { stream: true })
          }
        } finally {
          reader.releaseLock()
        }
        text += decoder.decode()
        validateCodexEventStream(text, policy)
        if (!current()) throw new Error('Revoked')
        return new Response(text, {
          headers: { 'content-type': 'text/event-stream' },
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const known = [
          'The saved model changed',
          'The response model changed',
          'Unsupported response event',
          'The model output exceeded its action budget',
          'No complete bounded model response',
          'The model returned a forbidden tool event',
          'Unbound function argument event',
          'Missing account authentication',
          'Upstream unavailable',
          'Action response exceeded its boundary',
          'Revoked',
        ]
        policy.observeFailure?.({
          stage: 'boundary',
          code: known.includes(message) ? message : 'Invalid response',
        })
        return Response.json(
          {
            error: {
              message:
                'The model response did not pass the Layer action boundary',
            },
          },
          { status: 502 },
        )
      }
    },
  })
  const close = () => {
    closed = true
    upstreamAbort.abort()
    server.stop(true)
    policy.signal.removeEventListener('abort', close)
  }
  policy.signal.addEventListener('abort', close, { once: true })
  if (policy.signal.aborted) close()
  return { url: `http://127.0.0.1:${server.port}/v1`, token, close }
}
