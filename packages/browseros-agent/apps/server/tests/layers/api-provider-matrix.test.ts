import { afterAll, expect, it, mock } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { LLM_PROVIDERS, type LLMConfig } from '@browseros/shared/schemas/llm'

mock.module('../../src/lib/clients/oauth', () => ({
  getOAuthTokenManager: () => ({
    refreshIfExpired: async () => ({
      accessToken: 'fixture-token',
      accountId: 'fixture-account',
    }),
    getTokens: () => ({ accessToken: 'fixture-token' }),
  }),
}))
const { runLayerTranslation } = await import('../../src/layers/action-runner')

import type { TranslationRun } from '../../src/layers/action-runner'
import { supportsLLMProvider } from '../../src/lib/clients/llm/provider'

// Exercise real SDK adapters and protocol parsing, with isolated OAuth tokens
// and a fetch fixture. This proves routing/contracts, not every model's quality.
const realFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = realFetch
})
const translated = {
  schema: 'pane.translation.v1',
  targetLanguage: 'en',
  blocks: [{ blockId: 'first', translatedText: 'Hello' }],
}
function run(
  config: LLMConfig,
  generated: boolean,
  managed = false,
): TranslationRun {
  return {
    binding: {
      profileId: randomUUID(),
      invocationId: randomUUID(),
      layerId: 'fixture',
      layerVersion: 'a'.repeat(64),
      actionId: 'test',
      tabId: 1,
      frameId: 0,
      documentId: 'fixture',
      instanceId: randomUUID(),
      routeEpoch: 0,
      snapshotId: randomUUID(),
      revocationGeneration: 1,
    },
    config,
    signal: new AbortController().signal,
    current: () => true,
    input: generated
      ? { schema: 'pane.script-task-input.v1' }
      : managed
        ? {
            schema: 'pane.page-task-input.v1',
            nodes: [
              {
                nodeId: 'first',
                role: 'complementary',
                text: 'Recommendations',
              },
            ],
          }
        : {
            targetLanguage: 'en',
            blocks: [{ blockId: 'first', text: 'Bonjour' }],
          },
    action: {
      id: 'test',
      kind: generated || managed ? 'page-task' : 'transform',
      trigger: 'click',
      instruction: 'Perform the saved action.',
      outputSchema: generated
        ? 'pane.script-task-receipt.v1'
        : managed
          ? 'pane.page-task-receipt.v1'
          : 'pane.translation.v1',
      ...(generated
        ? { execution: 'javascript' }
        : managed
          ? {}
          : { targetLanguage: 'en' }),
      limits: { maxSteps: 6, maxOutputTokens: 4096, deadlineMs: 10000 },
    },
    pageHost: {
      inspect: async () => ({ candidates: [{ selector: '#target' }] }),
      execute: async () => ({
        checks: [{ operationId: 'target', affectedElements: 1, intact: true }],
      }),
    },
  }
}
function response(provider: string, name: string, args: unknown) {
  const model = 'upstream-resolved-snapshot-999'
  const usage = { input_tokens: 10, output_tokens: 10 }
  if (provider === 'anthropic')
    return Response.json({
      id: 'msg-fixture',
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'tool_use', id: randomUUID(), name, input: args }],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage,
    })
  if (provider === 'google')
    return Response.json({
      candidates: [
        {
          content: { role: 'model', parts: [{ functionCall: { name, args } }] },
          finishReason: 'STOP',
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 10,
        totalTokenCount: 20,
      },
      modelVersion: model,
    })
  if (provider === 'bedrock')
    return Response.json({
      output: {
        message: {
          role: 'assistant',
          content: [
            { toolUse: { toolUseId: randomUUID(), name, input: args } },
          ],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      metrics: { latencyMs: 1 },
    })
  if (['openai', 'azure', 'chatgpt-pro'].includes(provider)) {
    const item = {
      type: 'function_call',
      id: randomUUID(),
      call_id: randomUUID(),
      name,
      arguments: JSON.stringify(args),
      status: 'completed',
    }
    const value = {
      id: 'resp-fixture',
      object: 'response',
      created_at: 1,
      model,
      output: [item],
      status: 'completed',
      usage: {
        ...usage,
        total_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }
    if (provider === 'chatgpt-pro') {
      const events = [
        {
          type: 'response.created',
          response: { ...value, output: [], status: 'in_progress' },
        },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, arguments: '', status: 'in_progress' },
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: item.id,
          output_index: 0,
          delta: item.arguments,
        },
        {
          type: 'response.function_call_arguments.done',
          item_id: item.id,
          output_index: 0,
          arguments: item.arguments,
        },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: value },
      ]
      return new Response(
        events
          .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
          .join(''),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    }
    return Response.json(value)
  }
  return Response.json({
    id: 'chat-fixture',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: randomUUID(),
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  })
}

for (const provider of Object.values(LLM_PROVIDERS).filter(
  (p) => !['claude-code', 'codex', 'acp-custom', 'remote-hermes'].includes(p),
)) {
  for (const requested of [
    'tenant/custom-model-v99',
    'fast-alias',
    'future-model-2099-12-31',
  ])
    for (const mode of ['translation', 'managed page', 'generated page'])
      it(`${provider} executes ${mode} actions with ${requested}`, async () => {
        const generated = mode === 'generated page'
        const managed = mode === 'managed page'
        expect(supportsLLMProvider(provider)).toBe(true)
        let calls = 0
        globalThis.fetch = mock(
          async (url: RequestInfo | URL, init?: RequestInit) => {
            const request = new Request(url, init)
            const body = (await request.json()) as Record<string, any>
            calls++
            expect(body.tool_choice).not.toBe('required')
            expect(body.tool_choice?.type).not.toBe('any')
            expect(body.toolConfig?.functionCallingConfig?.mode).not.toBe('ANY')
            expect(body.toolConfig?.toolChoice?.any).toBeUndefined()
            // Every provider keeps the saved model/deployment, even when the server
            // reports an unrelated canonical model ID in its response.
            if (provider === 'google' || provider === 'bedrock')
              expect(decodeURIComponent(request.url)).toContain(requested)
            else expect(body.model).toBe(requested)
            const name = generated
              ? ['page_inspect', 'page_execute_script', 'complete_page_task'][
                  calls - 1
                ]
              : 'submit_layer_result'
            expect(name).toBeDefined()
            const args =
              name === 'page_execute_script'
                ? {
                    source: '(() => {})();',
                    assertions: [
                      {
                        id: 'target',
                        selector: '#target',
                        state: 'present',
                        maxMatches: 1,
                      },
                    ],
                  }
                : generated
                  ? {}
                  : managed
                    ? {
                        schema: 'pane.page-task-receipt.v1',
                        operations: [
                          {
                            nodeId: 'first',
                            kind: 'highlight',
                            label: 'Keep visible',
                          },
                        ],
                      }
                    : translated
            return response(provider, name, args)
          },
        ) as typeof fetch
        try {
          const result = await runLayerTranslation(
            run(
              {
                provider,
                providerId: 'saved',
                model: requested,
                apiKey: 'fixture-key',
                baseUrl: 'https://fixture.invalid/v1',
                resourceName: 'fixture',
                region: 'us-east-1',
                accessKeyId: 'fixture-access',
                secretAccessKey: 'fixture-secret',
              },
              generated,
              managed,
            ),
          )
          expect(result.schema).toBe(
            generated
              ? 'pane.script-task-receipt.v1'
              : managed
                ? 'pane.page-task-receipt.v1'
                : 'pane.translation.v1',
          )
          expect(calls).toBe(generated ? 3 : 1)
        } finally {
          globalThis.fetch = realFetch
        }
      })
}

for (const provider of ['acp-custom', 'remote-hermes'] as const) {
  it(`${provider} fails explicitly instead of using another provider`, async () => {
    const fetch = mock(async () => {
      throw new Error('Unexpected network access')
    })
    globalThis.fetch = fetch as typeof globalThis.fetch
    try {
      await expect(
        runLayerTranslation(run({ provider, model: 'any' }, true)),
      ).rejects.toMatchObject({ code: 'PROVIDER_ADAPTER_UNAVAILABLE' })
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = realFetch
    }
  })
}

for (const [status, code] of [
  [401, 'API_AUTH_REQUIRED'],
  [403, 'API_REQUEST_REJECTED'],
  [400, 'API_REQUEST_REJECTED'],
  [429, 'API_RATE_LIMITED'],
  [503, 'API_UNAVAILABLE'],
] as const) {
  it(`reports safe provider errors for HTTP ${status} without fallback or retries`, async () => {
    const fetch = mock(async () =>
      Response.json(
        {
          error: {
            message: 'secret-provider-output',
            type: 'invalid_request_error',
          },
        },
        { status },
      ),
    )
    globalThis.fetch = fetch as typeof globalThis.fetch
    try {
      await expect(
        runLayerTranslation(
          run(
            {
              provider: 'openai-compatible',
              model: 'arbitrary',
              baseUrl: 'https://fixture.invalid/v1',
            },
            true,
          ),
        ),
      ).rejects.toMatchObject({ code })
      expect(fetch).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = realFetch
    }
  })
}

it('does not accept plain text as a completed tool action', async () => {
  globalThis.fetch = mock(async () =>
    Response.json({
      id: 'plain',
      object: 'chat.completion',
      created: 1,
      model: 'any',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Done!' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }),
  ) as typeof fetch
  try {
    for (const generated of [false, true])
      await expect(
        runLayerTranslation(
          run(
            {
              provider: 'openai-compatible',
              model: 'text-only',
              baseUrl: 'https://fixture.invalid/v1',
            },
            generated,
          ),
        ),
      ).rejects.toMatchObject({ code: 'PROVIDER_NO_ACTION_RESULT' })
  } finally {
    globalThis.fetch = realFetch
  }
})

it('bounds accepted ChatGPT account output even though its endpoint strips generation ceilings', async () => {
  globalThis.fetch = mock(async () => {
    const normal = response('chatgpt-pro', 'submit_layer_result', translated)
    return new Response(
      (await normal.text()).replaceAll(
        '"output_tokens":10',
        '"output_tokens":5000',
      ),
      { headers: { 'content-type': 'text/event-stream' } },
    )
  }) as typeof fetch
  try {
    await expect(
      runLayerTranslation(
        run({ provider: 'chatgpt-pro', model: 'custom-account-model' }, false),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_OUTPUT_BUDGET' })
  } finally {
    globalThis.fetch = realFetch
  }
})
