/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import type { LanguageModel } from 'ai'
import { wrapAcpProviderExecutedTools } from '../../../src/lib/agents/acp/wrap-acp-provider-tools'

describe('wrapAcpProviderExecutedTools', () => {
  it('normalizes MCP tool titles and marks provider-executed parts dynamic', async () => {
    const base = {
      specificationVersion: 'v2' as const,
      provider: 'acpx',
      modelId: 'codex',
      supportedUrls: {},
      async doStream() {
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'Tool: browseros/pi_read',
                input: '{"pageId":"page_1"}',
                providerExecuted: true,
              })
              controller.enqueue({
                type: 'tool-result',
                toolCallId: 'c1',
                toolName: 'Tool: browseros/pi_read',
                result: { ok: true },
                providerExecuted: true,
              })
              controller.enqueue({
                type: 'tool-call',
                toolCallId: 'c2',
                toolName: 'Read SKILL.md',
                input: '{}',
                providerExecuted: true,
              })
              controller.close()
            },
          }),
        }
      },
    }

    const wrapped = wrapAcpProviderExecutedTools(
      base as unknown as LanguageModel,
    ) as typeof base
    const { stream } = await wrapped.doStream()
    const parts: Array<Record<string, unknown>> = []
    for await (const part of stream as ReadableStream<
      Record<string, unknown>
    >) {
      parts.push(part)
    }

    expect(parts[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'pi_read',
      providerExecuted: true,
      dynamic: true,
    })
    expect(parts[1]).toMatchObject({
      type: 'tool-result',
      toolName: 'pi_read',
      providerExecuted: true,
      dynamic: true,
    })
    expect(parts[2]).toMatchObject({
      type: 'tool-call',
      toolName: 'Read SKILL.md',
      providerExecuted: true,
      dynamic: true,
    })
  })

  describe('tool-call input sanitization (acpx-ai-provider JSON parsing bug)', () => {
    function streamOf(chunks: Array<Record<string, unknown>>): LanguageModel {
      const base = {
        specificationVersion: 'v2' as const,
        provider: 'acpx',
        modelId: 'codex',
        supportedUrls: {},
        async doStream() {
          return {
            stream: new ReadableStream({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk)
                controller.close()
              },
            }),
          }
        },
      }
      return base as unknown as LanguageModel
    }

    async function collect(model: LanguageModel) {
      const wrapped = wrapAcpProviderExecutedTools(model) as {
        doStream: () => Promise<{ stream: ReadableStream<unknown> }>
      }
      const { stream } = await wrapped.doStream()
      const parts: Array<Record<string, unknown>> = []
      for await (const part of stream as ReadableStream<
        Record<string, unknown>
      >) {
        parts.push(part)
      }
      return parts
    }

    it('wraps non-JSON status text (acpx-ai-provider bug) into valid, parseable JSON', async () => {
      const garbled =
        'mcp__browseros__tabs (pending)mcp__browseros__tabs: https://news.ycombinator.comtool calltool call (completed): Dry-run. Would tabs on (unknown target) at (unknown url). Re-call with __promoted:true to execute..'
      const parts = await collect(
        streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'mcp__browseros__tabs',
            input: garbled,
            providerExecuted: true,
          },
        ]),
      )

      const input = parts[0]?.input
      expect(typeof input).toBe('string')
      // Must parse — this is exactly what AI SDK's
      // parseProviderExecutedDynamicToolCall does downstream and what
      // threw AI_InvalidToolInputError before this fix.
      const parsed = JSON.parse(input as string)
      expect(parsed).toEqual({ description: garbled })
    })

    it('leaves already-valid JSON input untouched', async () => {
      const parts = await collect(
        streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'pi_read',
            input: '{"pageId":"page_1"}',
            providerExecuted: true,
          },
        ]),
      )
      expect(parts[0]?.input).toBe('{"pageId":"page_1"}')
    })

    it('leaves empty/whitespace input untouched (AI SDK already treats it as {})', async () => {
      const parts = await collect(
        streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'acp_tool',
            input: '',
            providerExecuted: true,
          },
          {
            type: 'tool-call',
            toolCallId: 'c2',
            toolName: 'acp_tool',
            input: '   ',
            providerExecuted: true,
          },
        ]),
      )
      expect(parts[0]?.input).toBe('')
      expect(parts[1]?.input).toBe('   ')
    })

    it('does not touch non-string input', async () => {
      const parts = await collect(
        streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'acp_tool',
            input: { already: 'an object' },
            providerExecuted: true,
          },
        ]),
      )
      expect(parts[0]?.input).toEqual({ already: 'an object' })
    })
  })

  describe('tool-result result sanitization (acpx-ai-provider trace-string bug)', () => {
    function streamOf(chunks: Array<Record<string, unknown>>): LanguageModel {
      const base = {
        specificationVersion: 'v2' as const,
        provider: 'acpx',
        modelId: 'codex',
        supportedUrls: {},
        async doStream() {
          return {
            stream: new ReadableStream({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk)
                controller.close()
              },
            }),
          }
        },
      }
      return base as unknown as LanguageModel
    }

    async function collect(model: LanguageModel) {
      const wrapped = wrapAcpProviderExecutedTools(model) as {
        doStream: () => Promise<{ stream: ReadableStream<unknown> }>
      }
      const { stream } = await wrapped.doStream()
      const parts: Array<Record<string, unknown>> = []
      for await (const part of stream as ReadableStream<
        Record<string, unknown>
      >) {
        parts.push(part)
      }
      return parts
    }

    it('extracts JSON payload from acpx trace string in tool-result.result', async () => {
      const json = JSON.stringify({
        type: 'pi_page',
        href: 'pi://temp/temp_abc',
        navigate: true,
      })
      const trace = `mcp__browseros__pi_open (pending)mcp__browseros__pi_opentool calltool call (completed): ${json}`
      const parts = await collect(
        streamOf([
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'mcp__browseros__pi_open',
            result: trace,
            providerExecuted: true,
          },
        ]),
      )
      const result = parts[0]?.result as { text?: string }
      expect(result).toEqual({ text: json })
      expect(JSON.parse(result.text ?? '')).toMatchObject({
        type: 'pi_page',
        navigate: true,
      })
    })

    it('leaves already-valid JSON result (object) untouched', async () => {
      const parts = await collect(
        streamOf([
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'pi_read',
            result: { ok: true },
            providerExecuted: true,
          },
        ]),
      )
      expect(parts[0]?.result).toEqual({ ok: true })
    })

    it('leaves already-valid JSON result (string) untouched', async () => {
      const json = '{"ok":true}'
      const parts = await collect(
        streamOf([
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'pi_read',
            result: json,
            providerExecuted: true,
          },
        ]),
      )
      expect(parts[0]?.result).toBe(json)
    })

    it('does not rewrite plain-text results that incidentally contain "completed): "', async () => {
      const result =
        'Action completed): {"url":"https://example.com","title":"Example"} — navigation done'
      const parts = await collect(
        streamOf([
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'browser_navigate',
            result,
            providerExecuted: true,
          },
        ]),
      )
      // Must NOT extract the JSON fragment — result doesn't start with toolName prefix.
      expect(parts[0]?.result).toEqual({ description: result })
    })

    it('falls back to description wrapper when no JSON after completed marker', async () => {
      const trace =
        'some_tool (pending)some_tool: argstool calltool call (completed): not valid json {'
      const parts = await collect(
        streamOf([
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'some_tool',
            result: trace,
            providerExecuted: true,
          },
        ]),
      )
      expect(parts[0]?.result).toEqual({ description: trace })
    })
  })

  describe('stream-level error suppression (redundant turn-failure error before finish)', () => {
    function streamOf(chunks: Array<Record<string, unknown>>): LanguageModel {
      const base = {
        specificationVersion: 'v2' as const,
        provider: 'acpx',
        modelId: 'codex',
        supportedUrls: {},
        async doStream() {
          return {
            stream: new ReadableStream({
              start(controller) {
                for (const chunk of chunks) controller.enqueue(chunk)
                controller.close()
              },
            }),
          }
        },
        async doGenerate() {
          throw new Error('doGenerate should not be called directly')
        },
      }
      return base as unknown as LanguageModel
    }

    async function collect(model: LanguageModel) {
      const wrapped = wrapAcpProviderExecutedTools(model) as {
        doStream: () => Promise<{ stream: ReadableStream<unknown> }>
      }
      const { stream } = await wrapped.doStream()
      const parts: Array<Record<string, unknown>> = []
      for await (const part of stream as ReadableStream<
        Record<string, unknown>
      >) {
        parts.push(part)
      }
      return parts
    }

    it('drops a stream error chunk that immediately precedes finish (Claude Code Skill tool_use_error)', async () => {
      // Reproduces: Claude Code's native `Skill` tool fails ("Unknown skill:
      // pi-page-dsl"). acpx-ai-provider finalizes it as a normal
      // tool-result{isError:true}, but ALSO sets the whole turn's
      // result.status to "failed" and emits a redundant stream-level
      // `error` chunk immediately before `finish` — which the AI SDK
      // treats as fatal and would otherwise kill the entire turn instead
      // of letting the model see the tool error and continue.
      const parts = await collect(
        streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'Skill',
            input: '{"skill":"pi-page-dsl"}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'Skill',
            result: 'Unknown skill: pi-page-dsl',
            isError: true,
            providerExecuted: true,
          },
          {
            type: 'error',
            error: new Error('Unknown skill: pi-page-dsl'),
          },
          {
            type: 'finish',
            finishReason: 'tool-calls',
            usage: {},
          },
        ]),
      )

      expect(parts.map((p) => p.type)).toEqual([
        'tool-call',
        'tool-result',
        'finish',
      ])
      expect(parts[1]).toMatchObject({ type: 'tool-result', isError: true })
    })

    it('still suppresses the redundant error when the failing tool call is not the last one in the turn', async () => {
      // acpx-ai-provider emits errorPartIfFailed()+finish() once at the very
      // end of the stream based only on the turn's overall result.status —
      // decoupled from which specific tool call failed. A later, unrelated
      // successful tool call must not defeat suppression of the turn-level
      // error that traces back to an earlier failed one.
      const parts = await collect(
        streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'Skill',
            input: '{"skill":"pi-page-dsl"}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'Skill',
            result: 'Unknown skill: pi-page-dsl',
            isError: true,
            providerExecuted: true,
          },
          {
            type: 'tool-call',
            toolCallId: 'c2',
            toolName: 'navigate',
            input: '{}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'c2',
            toolName: 'navigate',
            result: { ok: true },
            providerExecuted: true,
          },
          {
            type: 'error',
            error: new Error('Unknown skill: pi-page-dsl'),
          },
          {
            type: 'finish',
            finishReason: 'tool-calls',
            usage: {},
          },
        ]),
      )

      expect(parts.map((p) => p.type)).toEqual([
        'tool-call',
        'tool-result',
        'tool-call',
        'tool-result',
        'finish',
      ])
    })

    it('passes through a stream error chunk not followed by finish (genuine fatal error, e.g. dropped connection)', async () => {
      const parts = await collect(
        streamOf([
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'navigate',
            input: '{}',
            providerExecuted: true,
          },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'navigate',
            result: { ok: true },
            providerExecuted: true,
          },
          {
            type: 'error',
            error: new Error('connection dropped'),
          },
        ]),
      )

      expect(parts.map((p) => p.type)).toEqual([
        'tool-call',
        'tool-result',
        'error',
      ])
    })

    it('forwards both errors when a second, unrelated error follows the first (neither precedes finish)', async () => {
      const parts = await collect(
        streamOf([
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'Skill',
            result: 'Unknown skill: pi-page-dsl',
            isError: true,
            providerExecuted: true,
          },
          {
            type: 'error',
            error: new Error('Unknown skill: pi-page-dsl'),
          },
          {
            type: 'error',
            error: new Error('connection dropped'),
          },
        ]),
      )

      expect(parts.map((p) => p.type)).toEqual([
        'tool-result',
        'error',
        'error',
      ])
    })

    it('doGenerate routes through the same suppression instead of throwing on the redundant error', async () => {
      const model = streamOf([
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'Skill',
          input: '{"skill":"pi-page-dsl"}',
          providerExecuted: true,
        },
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'Skill',
          result: 'Unknown skill: pi-page-dsl',
          isError: true,
          providerExecuted: true,
        },
        {
          type: 'error',
          error: new Error('Unknown skill: pi-page-dsl'),
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          usage: {},
        },
      ])

      const wrapped = wrapAcpProviderExecutedTools(model) as {
        doGenerate: () => Promise<{ content: Array<Record<string, unknown>> }>
      }
      const result = await wrapped.doGenerate()

      expect(
        result.content.some(
          (part) => part.type === 'tool-result' && part.isError === true,
        ),
      ).toBe(true)
    })
  })
})
