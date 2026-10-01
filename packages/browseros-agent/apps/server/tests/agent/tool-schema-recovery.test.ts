import { describe, expect, it } from 'bun:test'
import {
  APICallError,
  type LanguageModelV3CallOptions,
  type LanguageModelV3GenerateResult,
  type LanguageModelV3StreamPart,
} from '@ai-sdk/provider'
import { stepCountIs, ToolLoopAgent, tool, wrapLanguageModel } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'
import { createToolSchemaRecovery } from '../../src/agent/tool-schema-recovery'

const response: LanguageModelV3GenerateResult = {
  content: [{ type: 'text', text: 'Hello' }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: {
      total: 1,
      noCache: 1,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
  warnings: [],
}
const params: LanguageModelV3CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  tools: ['pi_page_create', 'search'].map((name) => ({
    type: 'function',
    name,
    inputSchema: { type: 'object', properties: {} },
  })),
}
function rejection(
  name = 'pi_page_create',
  statusCode = 400,
  message = `Invalid schema for function '${name}': bad schema`,
) {
  return new APICallError({
    message,
    statusCode,
    url: 'https://provider.invalid',
    requestBodyValues: {},
  })
}

describe('tool schema recovery', () => {
  it('returns ordinary execution failures to the model without disabling the tool or ending the loop', async () => {
    let executed = 0
    const recovery = createToolSchemaRecovery()
    const raw = new MockLanguageModelV3({
      doGenerate: async (p) => {
        if (p.prompt.some((m) => m.role === 'tool')) {
          expect(JSON.stringify(p.prompt)).toContain(
            'Memory service unavailable',
          )
          expect(p.tools?.map((t) => t.name)).toEqual(['memory_add'])
          return response
        }
        return {
          ...response,
          content: [
            {
              type: 'tool-call',
              toolCallId: 'memory-1',
              toolName: 'memory_add',
              input: '{}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        }
      },
    })
    const agent = new ToolLoopAgent({
      model: wrapLanguageModel({ model: raw, middleware: recovery.middleware }),
      tools: recovery.protectTools({
        memory_add: tool({
          inputSchema: z.object({}),
          execute: async () => {
            executed++
            throw new Error('Memory service unavailable')
          },
        }),
      }),
      stopWhen: stepCountIs(3),
    })
    const result = await agent.generate({ prompt: 'Remember this' })
    expect(result.text).toBe('Hello')
    expect(executed).toBe(1)
    expect(result.steps).toHaveLength(2)
  })

  for (const mode of ['generate', 'stream'] as const) {
    it(`recovers ${mode} requests and remembers rejected tools across turns`, async () => {
      const calls: LanguageModelV3CallOptions[] = []
      function check(p: LanguageModelV3CallOptions) {
        calls.push(p)
        if (p.tools?.some((t) => t.name === 'pi_page_create')) throw rejection()
      }
      const raw = new MockLanguageModelV3({
        doGenerate: async (p) => {
          check(p)
          return response
        },
        doStream: async (p) => {
          check(p)
          return {
            stream: new ReadableStream({
              start(c) {
                c.close()
              },
            }),
          }
        },
      })
      const recovery = createToolSchemaRecovery()
      const model = wrapLanguageModel({
        model: raw,
        middleware: recovery.middleware,
      })
      for (let turn = 0; turn < 2; turn++) {
        if (mode === 'generate') await model.doGenerate(params)
        else await model.doStream(params)
      }
      expect(calls).toHaveLength(3)
      expect(calls[1].tools?.map((t) => t.name)).toEqual(['search'])
      expect(calls[2].tools?.map((t) => t.name)).toEqual(['search'])
      expect(JSON.stringify(calls[1].prompt)).toContain(
        'temporarily unavailable',
      )
      expect(params.prompt).toHaveLength(1)
      expect(params.tools).toHaveLength(2)
      const fresh = wrapLanguageModel({
        model: raw,
        middleware: createToolSchemaRecovery().middleware,
      })
      await fresh.doGenerate(params)
      expect(calls).toHaveLength(5)
    })
  }

  it('continues the SDK tool loop and executes healthy tools exactly once', async () => {
    let executed = 0
    const recovery = createToolSchemaRecovery()
    const raw = new MockLanguageModelV3({
      doGenerate: async (p) => {
        if (p.tools?.some((t) => t.name === 'pi_page_create')) throw rejection()
        if (p.prompt.some((m) => m.role === 'tool')) return response
        return {
          ...response,
          content: [
            {
              type: 'tool-call',
              toolCallId: 'search-1',
              toolName: 'search',
              input: '{}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        }
      },
    })
    const tools = recovery.protectTools({
      pi_page_create: tool({
        inputSchema: z.object({}),
        execute: async () => {
          throw new Error('Must not execute')
        },
      }),
      search: tool({
        inputSchema: z.object({}),
        execute: async () => {
          executed++
          return { found: true }
        },
      }),
    })
    const agent = new ToolLoopAgent({
      model: wrapLanguageModel({ model: raw, middleware: recovery.middleware }),
      tools,
      stopWhen: stepCountIs(3),
    })
    const result = await agent.generate({ prompt: 'hello' })
    expect(result.text).toBe('Hello')
    expect(executed).toBe(1)
    await expect(
      tools.pi_page_create.execute?.({}, { toolCallId: 'stale', messages: [] }),
    ).rejects.toThrow('temporarily unavailable')
  })

  it('bounds recovery and falls back to an honest text-only response', async () => {
    const calls: LanguageModelV3CallOptions[] = []
    const raw = new MockLanguageModelV3({
      doGenerate: async (p) => {
        calls.push(p)
        if (p.tools?.length) throw rejection(p.tools[0].name)
        return response
      },
    })
    const model = wrapLanguageModel({
      model: raw,
      middleware: createToolSchemaRecovery().middleware,
    })
    await model.doGenerate({
      ...params,
      toolChoice: { type: 'required' },
      tools: Array.from({ length: 10 }, (_, i) => ({
        type: 'function',
        name: `tool_${i}`,
        inputSchema: {},
      })),
    })
    expect(calls).toHaveLength(5)
    expect(calls[4].tools).toEqual([])
    expect(calls[4].toolChoice).toEqual({ type: 'none' })
    expect(JSON.stringify(calls[4].prompt)).toContain(
      'do not claim you performed that action',
    )
  })

  it('clears forced tool choice when that tool is rejected', async () => {
    const calls: LanguageModelV3CallOptions[] = []
    const raw = new MockLanguageModelV3({
      doGenerate: async (p) => {
        calls.push(p)
        if (calls.length === 1) throw rejection()
        return response
      },
    })
    await wrapLanguageModel({
      model: raw,
      middleware: createToolSchemaRecovery().middleware,
    }).doGenerate({
      ...params,
      toolChoice: { type: 'tool', toolName: 'pi_page_create' },
    })
    expect(calls[1].toolChoice).toEqual({ type: 'auto' })
  })

  it('does not hide unrelated failures or guess an unnamed/unadvertised tool', async () => {
    for (const error of [
      rejection('pi_page_create', 401),
      rejection('pi_page_create', 429),
      rejection('pi_page_create', 500),
      rejection('missing'),
      rejection('', 400, 'Context length exceeded'),
      new Error("Invalid schema for function 'pi_page_create'"),
    ]) {
      const raw = new MockLanguageModelV3({
        doGenerate: async () => {
          throw error
        },
      })
      await expect(
        wrapLanguageModel({
          model: raw,
          middleware: createToolSchemaRecovery().middleware,
        }).doGenerate(params),
      ).rejects.toBe(error)
      expect(raw.doGenerateCalls).toHaveLength(1)
    }
  })

  it('honors cancellation between attempts', async () => {
    const abort = new AbortController()
    const raw = new MockLanguageModelV3({
      doGenerate: async () => {
        abort.abort()
        throw rejection()
      },
    })
    await expect(
      wrapLanguageModel({
        model: raw,
        middleware: createToolSchemaRecovery().middleware,
      }).doGenerate({ ...params, abortSignal: abort.signal }),
    ).rejects.toThrow()
    expect(raw.doGenerateCalls).toHaveLength(1)
  })

  it('does not replay an established stream when it emits an error', async () => {
    const error = rejection()
    const raw = new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream<LanguageModelV3StreamPart>({
          start(c) {
            c.enqueue({ type: 'error', error })
            c.close()
          },
        }),
      }),
    })
    const result = await wrapLanguageModel({
      model: raw,
      middleware: createToolSchemaRecovery().middleware,
    }).doStream(params)
    expect((await result.stream.getReader().read()).value).toEqual({
      type: 'error',
      error,
    })
    expect(raw.doStreamCalls).toHaveLength(1)
  })
})
