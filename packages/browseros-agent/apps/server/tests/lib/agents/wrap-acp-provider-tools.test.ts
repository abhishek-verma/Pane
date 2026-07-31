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
})
