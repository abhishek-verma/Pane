import { randomBytes, randomUUID } from 'node:crypto'
import { StreamableHTTPTransport } from '@hono/mcp'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolSet } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'

/** Invocation-local loopback endpoint. The random credential is never put in
 * page data, tool descriptions, model prompts, logs, or shared MCP inventory. */
export function createPrivateLayerMcpApp(tools: ToolSet, signal: AbortSignal) {
  const token = randomBytes(32).toString('hex')
  let closed = false
  const live = new Set<McpServer>()
  const app = new Hono()
  app.all('/mcp', async (c) => {
    if (
      closed ||
      signal.aborted ||
      c.req.header('authorization') !== `Bearer ${token}`
    )
      return c.json({ error: 'Unavailable' }, 403)
    if (c.req.method !== 'POST') return c.body(null, 405)
    if (live.size >= 4) return c.json({ error: 'Busy' }, 429)
    const server = new McpServer({ name: 'pane_layer', version: '1' })
    live.add(server)
    try {
      for (const [name, entry] of Object.entries(tools)) {
        const schema = entry.inputSchema as z.ZodTypeAny
        let objectSchema = schema
        // MCP's schema exporter cannot describe ZodEffects. Export the strict
        // object underneath and retain the full canonical refinement below.
        while (objectSchema instanceof z.ZodEffects)
          objectSchema = objectSchema.innerType()
        if (!(objectSchema instanceof z.ZodObject) || !entry.execute)
          throw new Error('Invalid private tool contract')
        const execute = entry.execute
        const register = server.registerTool.bind(server) as unknown as (
          name: string,
          config: {
            description?: string
            inputSchema: z.ZodObject<z.ZodRawShape>
          },
          handler: (args: Record<string, unknown>) => Promise<CallToolResult>,
        ) => void
        register(
          name,
          { description: entry.description, inputSchema: objectSchema },
          async (args) => {
            if (closed || signal.aborted)
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: 'This Layer action has ended.',
                  },
                ],
              }
            try {
              const parsed = await schema.safeParseAsync(args)
              if (!parsed.success)
                return {
                  isError: true,
                  content: [
                    {
                      type: 'text' as const,
                      text: 'The arguments do not satisfy the private Layer tool contract.',
                    },
                  ],
                }
              const result = await execute(parsed.data, {
                toolCallId: randomUUID(),
                messages: [],
                abortSignal: signal,
              })
              return {
                content: [
                  { type: 'text' as const, text: JSON.stringify(result) },
                ],
              }
            } catch {
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: 'The page operation failed or is no longer authorized. Inspect current state before retrying within the remaining budget.',
                  },
                ],
              }
            }
          },
        )
      }
      const transport = new StreamableHTTPTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await server.connect(transport)
      const response = await transport.handleRequest(c)
      if (!response) return c.body(null, 204)
      return new Response(await response.text(), {
        status: response.status,
        headers: response.headers,
      })
    } finally {
      live.delete(server)
      await server.close()
    }
  })
  const close = () => {
    closed = true
    for (const item of live) void item.close()
    signal.removeEventListener('abort', close)
  }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) close()
  return { app, token, close }
}

export function startPrivateLayerMcp(tools: ToolSet, signal: AbortSignal) {
  const endpoint = createPrivateLayerMcpApp(tools, signal)
  try {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      maxRequestBodySize: 2 * 1024 * 1024,
      fetch: endpoint.app.fetch,
    })
    const close = () => {
      endpoint.close()
      server.stop(true)
      signal.removeEventListener('abort', close)
    }
    signal.addEventListener('abort', close, { once: true })
    if (signal.aborted) close()
    return {
      url: `http://127.0.0.1:${server.port}/mcp`,
      token: endpoint.token,
      close,
    }
  } catch (error) {
    endpoint.close()
    throw error
  }
}
