import { describe, expect, it } from 'bun:test'
import type { AcpRuntimeEvent, AcpxProvider } from 'acpx-ai-provider'
import {
  PaneAcpEventTranslator,
  PaneAcpLanguageModel,
} from '../../../../src/lib/agents/acp/language-model'

describe('Pane ACP protocol boundary', () => {
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

  it('never reports success for a dangling call and emits each fatal error once', () => {
    const translator = new PaneAcpEventTranslator(() => 'id')
    translator.translate({
      type: 'tool_call',
      toolCallId: 'call',
      text: 'working',
      status: 'pending',
    })
    expect(translator.finish({ status: 'completed' }).at(-1)).toMatchObject({
      finishReason: 'error',
    })
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
