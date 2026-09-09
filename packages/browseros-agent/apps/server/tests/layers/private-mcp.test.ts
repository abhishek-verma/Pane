import { expect, it } from 'bun:test'
import { tool } from 'ai'
import { z } from 'zod'
import { createPrivateLayerMcpApp } from '../../src/layers/private-mcp'

it('exports refined object fields and enforces the canonical refinement before execution', async () => {
  let calls = 0
  const endpoint = createPrivateLayerMcpApp(
    {
      submit_layer_result: tool({
        inputSchema: z
          .object({ left: z.string(), right: z.string() })
          .strict()
          .refine((value) => value.left.length + value.right.length <= 4),
        execute: async () => {
          calls++
          return { accepted: true }
        },
      }),
    },
    new AbortController().signal,
  )
  const request = async (method: string, params = {}) =>
    (
      await endpoint.app.request('/mcp', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${endpoint.token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    ).json() as Promise<any>
  try {
    const list = await request('tools/list')
    expect(Object.keys(list.result.tools[0].inputSchema.properties)).toEqual([
      'left',
      'right',
    ])
    expect(
      (
        await request('tools/call', {
          name: 'submit_layer_result',
          arguments: { left: 'abc', right: 'de' },
        })
      ).result.isError,
    ).toBe(true)
    expect(calls).toBe(0)
    expect(
      (
        await request('tools/call', {
          name: 'submit_layer_result',
          arguments: { left: 'a', right: 'b' },
        })
      ).result.isError,
    ).toBeUndefined()
    expect(calls).toBe(1)
  } finally {
    endpoint.close()
  }
})

it('authenticates every private MCP request, exposes only supplied tools and revokes on cancellation', async () => {
  let calls = 0
  const controller = new AbortController()
  const endpoint = createPrivateLayerMcpApp(
    {
      page_inspect: tool({
        inputSchema: z.object({}).strict(),
        execute: async () => {
          calls++
          return { candidates: [] }
        },
      }),
    },
    controller.signal,
  )
  const request = (
    method: string,
    params: unknown = {},
    token = endpoint.token,
  ) =>
    endpoint.app.request('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  try {
    expect((await request('tools/list', {}, 'wrong')).status).toBe(403)
    const list = (await (await request('tools/list')).json()) as {
      result: { tools: Array<{ name: string }> }
    }
    expect(list.result.tools.map((tool) => tool.name)).toEqual(['page_inspect'])
    const unknown = (await (
      await request('tools/call', { name: 'read_file', arguments: {} })
    ).json()) as { result?: { isError?: boolean }; error?: unknown }
    expect(Boolean(unknown.error || unknown.result?.isError)).toBe(true)
    const invalid = (await (
      await request('tools/call', {
        name: 'page_inspect',
        arguments: { extra: true },
      })
    ).json()) as { result?: { isError?: boolean }; error?: unknown }
    expect(Boolean(invalid.error || invalid.result?.isError)).toBe(true)
    expect(calls).toBe(0)
    const call = (await (
      await request('tools/call', { name: 'page_inspect', arguments: {} })
    ).json()) as { result: { content: Array<{ text: string }> } }
    expect(JSON.parse(call.result.content[0].text)).toEqual({ candidates: [] })
    expect(calls).toBe(1)
    controller.abort()
    expect(
      (await request('tools/call', { name: 'page_inspect', arguments: {} }))
        .status,
    ).toBe(403)
    expect(calls).toBe(1)
  } finally {
    endpoint.close()
  }
})
