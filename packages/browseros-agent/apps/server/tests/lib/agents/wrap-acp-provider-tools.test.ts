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
})
