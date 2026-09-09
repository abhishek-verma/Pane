import { expect, it } from 'bun:test'
import {
  type CodexTransportPolicy,
  restrictCodexRequest,
  startCodexActionTransport,
  validateCodexEventStream,
} from '../../src/layers/codex-transport'

const policy: CodexTransportPolicy = {
  model: 'saved',
  tools: new Set(['mcp__pane_layer__page_inspect']),
  maxRequests: 2,
  maxOutputTokens: 1000,
  signal: new AbortController().signal,
  current: () => true,
}
const events = (items: unknown[], tokens = 10) =>
  'data: ' +
  JSON.stringify({
    type: 'response.completed',
    response: {
      model: 'saved',
      output: items,
      usage: { output_tokens: tokens },
    },
  }) +
  '\n\n'
it('distinguishes accepted output from an unavailable account generation ceiling', () => {
  const account = { ...policy, providerOutputCeiling: false }
  const request = restrictCodexRequest(
    { model: 'saved', stream: true, max_output_tokens: 999 },
    account,
  )
  expect('max_output_tokens' in request).toBe(false)
  expect(() => validateCodexEventStream(events([], 501), account)).toThrow(
    'budget',
  )
})
it('advertises only canonical private namespaces even when CLI tools are deferred', () => {
  const scoped = {
    ...policy,
    tools: new Set(['mcp__pane_layer.submit_layer_result']),
    toolDefinitions: [
      {
        type: 'namespace' as const,
        name: 'mcp__pane_layer',
        tools: [
          {
            type: 'function' as const,
            name: 'submit_layer_result',
            parameters: { type: 'object' },
          },
        ],
      },
    ],
  }
  expect(
    restrictCodexRequest(
      { model: 'saved', stream: true, tools: [{ type: 'tool_search' }] },
      scoped,
    ).tools,
  ).toEqual(scoped.toolDefinitions)
  expect(() =>
    validateCodexEventStream(
      events([
        {
          id: 'one',
          type: 'function_call',
          namespace: 'mcp__pane_layer',
          name: 'submit_layer_result',
        },
      ]),
      scoped,
    ),
  ).not.toThrow()
  expect(() =>
    validateCodexEventStream(
      events([
        {
          id: 'one',
          type: 'function_call',
          namespace: 'different_server',
          name: 'submit_layer_result',
        },
      ]),
      scoped,
    ),
  ).toThrow('forbidden')
  expect(() =>
    validateCodexEventStream(
      events([
        { id: 'one', type: 'function_call', name: 'submit_layer_result' },
      ]),
      scoped,
    ),
  ).toThrow('forbidden')
})
it('rejects invalid limits before opening a transport', () => {
  for (const limits of [
    { maxRequests: 0 },
    { maxRequests: 0.5 },
    { maxOutputTokens: 1 },
    { maxOutputTokens: Infinity },
  ])
    expect(() =>
      startCodexActionTransport(
        { ...policy, ...limits },
        async () => new Response(),
      ),
    ).toThrow('Invalid Codex action limits')
})
it('removes built-in tools and enforces the saved model, request/output policy on the wire', () => {
  const body = restrictCodexRequest(
    {
      model: 'saved',
      stream: true,
      tools: [
        { type: 'function', name: 'apply_patch' },
        { type: 'custom', name: 'view_image' },
        { type: 'function', name: 'mcp__pane_layer__page_inspect' },
      ],
      max_output_tokens: 99999,
    },
    policy,
  )
  expect(body.tools).toEqual([
    { type: 'function', name: 'mcp__pane_layer__page_inspect' },
  ])
  expect(body.max_output_tokens).toBe(500)
  expect(body.parallel_tool_calls).toBe(false)
  expect(() =>
    restrictCodexRequest({ model: 'other', stream: true }, policy),
  ).toThrow('saved model')
})
it('rejects forbidden tool events even if omitted from the terminal output', () => {
  expect(() =>
    validateCodexEventStream(
      events([
        {
          id: 'allowed',
          type: 'function_call',
          name: 'mcp__pane_layer__page_inspect',
        },
      ]),
      policy,
    ),
  ).not.toThrow()
  for (const item of [
    { type: 'function_call', name: 'apply_patch' },
    { type: 'custom_tool_call', name: 'apply_patch' },
    { type: 'computer_call' },
  ]) {
    const early =
      'data: ' +
      JSON.stringify({ type: 'response.output_item.added', item }) +
      '\n\n'
    expect(() => validateCodexEventStream(early + events([]), policy)).toThrow(
      'forbidden',
    )
  }
})
it('rejects missing completion, excess output and events after completion', () => {
  expect(() => validateCodexEventStream('', policy)).toThrow('No complete')
  expect(() => validateCodexEventStream(events([], 501), policy)).toThrow(
    'budget',
  )
  expect(() =>
    validateCodexEventStream(events([]) + events([]), policy),
  ).toThrow('followed')
})

it('rejects argument events not bound to an allowed tool item and unknown event types', () => {
  const unbound =
    'data: ' +
    JSON.stringify({
      type: 'response.function_call_arguments.done',
      item_id: 'unknown',
      name: 'apply_patch',
      arguments: '{}',
    }) +
    '\n\n'
  expect(() => validateCodexEventStream(unbound + events([]), policy)).toThrow(
    'Unbound',
  )
  const unknown =
    'data: ' + JSON.stringify({ type: 'response.new_tool_event' }) + '\n\n'
  expect(() => validateCodexEventStream(unknown + events([]), policy)).toThrow(
    'Unsupported',
  )
})
