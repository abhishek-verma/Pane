import { describe, expect, it } from 'bun:test'
import type { AcpRuntimeEvent, AcpxProvider } from 'acpx-ai-provider'
import {
  PaneAcpEventTranslator,
  PaneAcpLanguageModel,
} from '../../../../src/lib/agents/acp/language-model'

describe('Pane ACP protocol boundary', () => {
  it('preserves a terminal adapter error when no structured output is supplied', () => {
    const translator = new PaneAcpEventTranslator(() => 'id')
    const parts = translator.translate({
      type: 'tool_call',
      toolCallId: 'memory-first',
      title: 'memory_add',
      status: 'failed',
      text: 'MCP request timed out while waiting for approval',
      content: [],
    })
    expect(parts.at(-1)).toMatchObject({
      type: 'tool-result',
      isError: true,
      result: { error: 'MCP request timed out while waiting for approval' },
    })
    expect(translator.finish({ status: 'completed' }).at(-1)).toMatchObject({
      finishReason: 'stop',
    })
  })

  for (const scenario of [
    'recovered',
    'still-pending',
    'runtime-failed',
    'cancelled',
  ] as const) {
    it(`handles an unfinished native tool with bounded continuation: ${scenario}`, async () => {
      const prompts: string[] = []
      const abort = new AbortController()
      let nextId = 0
      const provider = {
        settings: { agent: 'test' },
        generateId: () => `id-${nextId++}`,
        ensureHandle: async () => ({ handle: {}, sessionKey: 'chat' }),
        markSessionKeyUsed: () => true,
        runtime: {
          startTurn(input: { text: string; signal?: AbortSignal }) {
            prompts.push(input.text)
            const number = prompts.length
            expect(input.signal).toBe(abort.signal)
            return {
              events: (async function* () {
                if (number === 2 && scenario === 'recovered') {
                  yield {
                    type: 'text_delta',
                    text: 'I could not confirm the memory write. I have not repeated it.',
                  }
                } else {
                  yield {
                    type: 'tool_call',
                    toolCallId: `memory-${number}`,
                    title: 'memory_add',
                    text: '',
                    status: 'in_progress',
                    rawInput: { content: 'Remember this' },
                  }
                }
                if (scenario === 'cancelled') abort.abort()
              })(),
              result: Promise.resolve(
                scenario === 'runtime-failed'
                  ? { status: 'failed', error: { message: 'Process exited' } }
                  : { status: 'completed', stopReason: 'end_turn' },
              ),
              cancel: async () => {},
            }
          },
        },
      } as unknown as AcpxProvider
      const { stream } = await new PaneAcpLanguageModel(provider).doStream({
        prompt: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Save my preference' }],
          },
        ],
        abortSignal: abort.signal,
      })
      const parts = []
      for await (const part of stream) parts.push(part)
      const continues = scenario === 'recovered' || scenario === 'still-pending'
      expect(prompts).toHaveLength(continues ? 2 : 1)
      if (continues) {
        expect(prompts[1]).toContain('Their outcomes are unknown')
        expect(prompts[1]).toContain('do not repeat a write')
        expect(prompts[1]).not.toContain('Save my preference')
      }
      expect(parts.filter((p) => p.type === 'tool-result')).toHaveLength(
        scenario === 'still-pending' ? 2 : 1,
      )
      expect(parts.filter((p) => p.type === 'error')).toHaveLength(
        scenario === 'runtime-failed' ? 1 : 0,
      )
      if (scenario === 'recovered')
        expect(JSON.stringify(parts)).toContain('I have not repeated it')
      if (scenario === 'still-pending')
        expect(JSON.stringify(parts)).toContain(
          'Some tool calls ended without a confirmed result',
        )
    })
  }

  it('preserves each MCP startup server and exposes its diagnostic as readable output', () => {
    const translator = new PaneAcpEventTranslator(() => 'id')
    for (const server of ['node_repl', 'browseros']) {
      const message = `MCP server \`${server}\` failed to start: connection closed during initialize`
      const parts = translator.translate({
        type: 'tool_call',
        toolCallId: `mcp_startup.${server}`,
        title: `mcp__${server}__startup`,
        text: message,
        status: 'failed',
        content: [
          { type: 'content', content: { type: 'text', text: message } },
        ],
      })
      expect(parts.at(-1)).toMatchObject({
        type: 'tool-result',
        toolName: `MCP startup: ${server}`,
        isError: true,
        result: { content: [{ type: 'text', text: message }] },
      })
    }
    expect(translator.finish({ status: 'completed' }).at(-1)).toMatchObject({
      finishReason: 'stop',
    })
  })

  it('sends changed system context on continuation without replaying history or unchanged context', async () => {
    const turns: string[] = []
    let fresh = true
    const model = new PaneAcpLanguageModel({
      settings: { agent: 'test' },
      generateId: () => 'id',
      ensureHandle: async () => ({ handle: {}, sessionKey: 'chat' }),
      markSessionKeyUsed: () => {
        const first = fresh
        fresh = false
        return first
      },
      runtime: {
        startTurn(input: { text: string }) {
          turns.push(input.text)
          return {
            events: (async function* () {
              yield { type: 'text_delta', text: 'OK' }
            })(),
            result: Promise.resolve({
              status: 'completed',
              stopReason: 'end_turn',
            }),
            cancel: async () => {},
          }
        },
      },
    } as unknown as AcpxProvider)
    for (const content of [
      'Pane memory: tea',
      'Pane memory: tea',
      'Pane memory: coffee',
    ]) {
      await model.doGenerate({
        prompt: [
          { role: 'system', content },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Old history' }],
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'Current request' }],
          },
        ],
      })
    }
    expect(turns[0]).toContain('Pane memory: tea')
    expect(turns[1]).toBe('User: Current request')
    expect(turns[2]).toContain('Pane memory: coffee')
    expect(turns[2]).not.toContain('Pane memory: tea')
    expect(turns[2]).not.toContain('Old history')
  })

  it('normalizes the real Codex MCP invocation envelope into the shared tool contract', () => {
    const translator = new PaneAcpEventTranslator(() => 'id')
    const parts = translator.translate({
      type: 'tool_call',
      toolCallId: 'call',
      title: 'mcp.browseros.suggest_schedule',
      text: 'status',
      status: 'completed',
      rawInput: {
        server: 'browseros',
        tool: 'suggest_schedule',
        arguments: { query: 'test' },
      },
      rawOutput: {
        result: {
          content: [{ type: 'text', text: '{"type":"schedule_suggestion"}' }],
        },
        error: null,
      },
    })
    expect(parts[3]).toMatchObject({
      toolName: 'suggest_schedule',
      input: '{"query":"test"}',
    })
    expect(parts[4]).toMatchObject({
      result: {
        content: [{ type: 'text', text: '{"type":"schedule_suggestion"}' }],
      },
    })
  })

  it('unwraps ACP images and text while preserving file diffs', () => {
    const translator = new PaneAcpEventTranslator(() => 'id')
    const image = {
      type: 'image' as const,
      data: 'aW1hZ2U=',
      mimeType: 'image/png',
    }
    const diff = {
      type: 'diff' as const,
      path: '/tmp/file',
      oldText: 'old',
      newText: 'new',
    }
    const parts = translator.translate({
      type: 'tool_call',
      toolCallId: 'call',
      title: 'browseros/startup',
      text: '',
      status: 'completed',
      content: [
        { type: 'content', content: { type: 'text', text: 'Started' } },
        { type: 'content', content: image },
        diff,
      ],
    })
    expect(parts.at(-1)).toMatchObject({
      toolName: 'startup',
      isError: false,
      result: { content: [{ type: 'text', text: 'Started' }, image, diff] },
    })
  })

  it('marks dangling tools unknown without turning a completed native turn into a fatal error', () => {
    const translator = new PaneAcpEventTranslator(() => 'id')
    translator.translate({
      type: 'tool_call',
      toolCallId: 'call',
      text: 'working',
      status: 'pending',
    })
    const parts = translator.finish({ status: 'completed' })
    expect(parts.at(-1)).toMatchObject({ finishReason: 'stop' })
    expect(parts.find((p) => p.type === 'tool-result')).toMatchObject({
      isError: true,
    })
    expect(parts.some((p) => p.type === 'error')).toBe(false)
    expect(JSON.stringify(parts)).toContain('Outcome unknown')
    const errored = new PaneAcpEventTranslator(() => 'id')
    expect(
      errored.translate({ type: 'error', message: 'Connection lost' }),
    ).toEqual([])
    expect(
      errored
        .finish({ status: 'failed', error: { message: 'Connection lost' } })
        .filter((p) => p.type === 'error'),
    ).toHaveLength(1)
  })
  it('uses one call id and raw values, never rendered status as JSON', () => {
    const translator = new PaneAcpEventTranslator(() => 'text-id')
    const parts = [
      ...translator.translate({
        type: 'tool_call',
        toolCallId: 'call-1',
        title: 'Tool: browseros/trigger_list',
        text: 'pending status',
        rawInput: { filter: false },
        status: 'pending',
      }),
      ...translator.translate({
        type: 'tool_call',
        toolCallId: 'call-1',
        text: 'a completely different status',
        rawOutput: { triggers: [] },
        status: 'completed',
      }),
    ]
    expect(
      parts.map((p) =>
        'id' in p ? p.id : 'toolCallId' in p ? p.toolCallId : null,
      ),
    ).toEqual(Array(5).fill('call-1'))
    expect(parts[3]).toMatchObject({
      type: 'tool-call',
      toolName: 'trigger_list',
      input: '{"filter":false}',
      dynamic: true,
      providerExecuted: true,
    })
    expect(parts[4]).toMatchObject({
      type: 'tool-result',
      result: { triggers: [] },
    })
    expect(
      translator.translate({
        type: 'tool_call',
        toolCallId: 'call-1',
        text: 'late notification',
        status: 'completed',
      }),
    ).toEqual([])
  })

  it('keeps failed tools recoverable and closes incomplete tools on terminal failure', () => {
    const translator = new PaneAcpEventTranslator(() => 'text-id')
    const failed = translator.translate({
      type: 'tool_call',
      toolCallId: 'bad',
      text: 'failed',
      status: 'failed',
      rawOutput: { error: 'retry with another path' },
    })
    expect(failed.at(-1)).toMatchObject({ type: 'tool-result', isError: true })
    expect(failed.some((p) => p.type === 'error')).toBe(false)
    translator.translate({
      type: 'tool_call',
      toolCallId: 'next',
      text: '',
      status: 'in_progress',
    })
    const terminal = translator.finish({
      status: 'failed',
      error: { message: 'Process exited' },
    })
    expect(terminal.filter((p) => p.type === 'tool-result')).toHaveLength(1)
    expect(terminal.filter((p) => p.type === 'error')).toHaveLength(1)
    expect(terminal.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: 'error',
    })
  })

  it('does not impose a five-minute turn deadline and emits a final result after tool recovery', async () => {
    let turnInput: Record<string, unknown> = {}
    const events: AcpRuntimeEvent[] = [
      {
        type: 'tool_call',
        toolCallId: 'a',
        title: 'skills_load',
        text: '',
        status: 'failed',
        rawInput: { name: 'missing' },
        rawOutput: { error: 'not found' },
      },
      {
        type: 'tool_call',
        toolCallId: 'b',
        title: 'skills_list',
        text: '',
        status: 'completed',
        rawOutput: { skills: [] },
      },
      { type: 'text_delta', text: 'Complete' },
    ]
    const provider = {
      settings: { agent: 'test' },
      generateId: () => 'id',
      ensureHandle: async () => ({ handle: {}, sessionKey: 'chat' }),
      markSessionKeyUsed: () => true,
      runtime: {
        startTurn(input: Record<string, unknown>) {
          turnInput = input
          return {
            events: (async function* () {
              yield* events
            })(),
            result: Promise.resolve({
              status: 'completed',
              stopReason: 'end_turn',
            }),
            cancel: async () => {},
          }
        },
      },
    } as unknown as AcpxProvider
    const model = new PaneAcpLanguageModel(provider)
    const abort = new AbortController()
    const result = await model.doGenerate({
      prompt: [],
      abortSignal: abort.signal,
    })
    expect(turnInput.timeoutMs).toBe(0)
    expect(turnInput.signal).toBe(abort.signal)
    expect(result.content).toContainEqual({ type: 'text', text: 'Complete' })
    expect(result.finishReason).toBe('stop')
    expect(result.content.filter((p) => p.type === 'tool-result')).toHaveLength(
      2,
    )
  })
})
