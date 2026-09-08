import type {
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from '@ai-sdk/provider'
import {
  type AcpRuntimeEvent,
  type AcpRuntimeTurnResult,
  AcpxLanguageModel,
  type AcpxProvider,
  convertPrompt,
  createJsonCleanupTransform,
  EventTranslator,
} from 'acpx-ai-provider'
import { normalizeAcpToolTitle } from './tool-title'

type ToolEvent = Extract<AcpRuntimeEvent, { type: 'tool_call' }>
type ToolState = {
  name: string
  input?: unknown
  output?: unknown
  content?: ToolEvent['content']
  mcp?: boolean
}
// V3 consumes this flag after adapting the V2 stream. V2 declarations predate it.
const dynamic = { dynamic: true }

/** Preserve protocol data; human-readable ACP status text is never JSON input. */
export class PaneAcpEventTranslator {
  private readonly text: EventTranslator
  private readonly pending = new Map<string, ToolState>()
  private readonly completed = new Set<string>()
  private runtimeError?: Extract<AcpRuntimeEvent, { type: 'error' }>

  constructor(generateId: () => string) {
    this.text = new EventTranslator({ generateId })
  }

  translate(event: AcpRuntimeEvent): LanguageModelV2StreamPart[] {
    if (event.type === 'error') {
      this.runtimeError = event
      return []
    }
    if (event.type !== 'tool_call') return this.text.translate(event)
    const id = event.toolCallId
    if (!id || this.completed.has(id)) return []
    const parts: LanguageModelV2StreamPart[] = []
    let state = this.pending.get(id)
    if (!state) {
      parts.push(...this.text.flush())
      state = { name: normalizeAcpToolTitle(event.title?.trim() || 'tool') }
      this.pending.set(id, state)
      parts.push({
        type: 'tool-input-start',
        id,
        toolName: state.name,
        providerExecuted: true,
        ...dynamic,
      })
    }
    if (event.rawInput !== undefined) {
      const raw = event.rawInput
      // ACP's Codex adapter carries the MCP invocation envelope. The Pane
      // transcript uses the same tool arguments/output as the API transport.
      if (
        raw &&
        typeof raw === 'object' &&
        'server' in raw &&
        'tool' in raw &&
        'arguments' in raw
      ) {
        state.mcp = true
        state.input = raw.arguments
      } else {
        state.input = raw
      }
    }
    if (event.rawOutput !== undefined) state.output = event.rawOutput
    if (event.content !== undefined) state.content = event.content
    if (event.status === 'completed' || event.status === 'failed') {
      parts.push(...this.complete(id, state, event.status === 'failed'))
    }
    return parts
  }

  private complete(
    id: string,
    state: ToolState,
    failed: boolean,
  ): LanguageModelV2StreamPart[] {
    this.pending.delete(id)
    this.completed.add(id)
    // Serialize once, including strings. A raw string is a value, not a JSON fragment.
    const input = JSON.stringify(state.input ?? {})
    let result =
      state.output ?? (state.content ? { content: state.content } : {})
    if (
      state.mcp &&
      result &&
      typeof result === 'object' &&
      'result' in result &&
      result.result &&
      typeof result.result === 'object' &&
      'content' in result.result
    ) {
      result = result.result
    }
    return [
      { type: 'tool-input-delta', id, delta: input },
      { type: 'tool-input-end', id },
      {
        type: 'tool-call',
        toolCallId: id,
        toolName: state.name,
        input,
        providerExecuted: true,
        ...dynamic,
      },
      {
        type: 'tool-result',
        toolCallId: id,
        toolName: state.name,
        result,
        isError: failed,
        providerExecuted: true,
        ...dynamic,
      },
    ]
  }

  finish(result: AcpRuntimeTurnResult): LanguageModelV2StreamPart[] {
    if (
      result.status === 'completed' &&
      (this.runtimeError || this.pending.size > 0)
    ) {
      result = {
        status: 'failed',
        error: this.runtimeError ?? {
          message: 'Agent ended its turn with an unfinished tool call.',
        },
      }
    }
    const parts = this.text.flush()
    for (const [id, state] of this.pending) {
      parts.push(
        ...this.complete(
          id,
          {
            ...state,
            output: { error: 'Agent turn ended before this tool completed.' },
          },
          true,
        ),
      )
    }
    parts.push(
      ...this.text.errorPartIfFailed(result),
      this.text.finish({ result }),
    )
    return parts
  }
}

/** ACP owns its reasoning loop; Pane owns transport fidelity and cancellation.
 * Inherited doGenerate consumes this same doStream, so both paths stay identical. */
export class PaneAcpLanguageModel extends AcpxLanguageModel {
  constructor(private readonly paneProvider: AcpxProvider) {
    super(paneProvider)
  }

  override async doStream(options: LanguageModelV2CallOptions) {
    const provider = this.paneProvider
    const { handle, sessionKey } = await provider.ensureHandle()
    const prompt = convertPrompt({
      prompt: options.prompt,
      responseFormat: options.responseFormat,
      mode: provider.markSessionKeyUsed(sessionKey) ? 'fresh' : 'continuation',
    })
    const turn = provider.runtime.startTurn({
      handle,
      ...prompt,
      mode: 'prompt',
      requestId: provider.generateId(),
      // No implicit wall-clock deadline: tools and human approval may take time.
      // ACP runtime defines zero as no timeout; the owning chat's signal cancels.
      timeoutMs: 0,
      signal: options.abortSignal,
    })
    const translator = new PaneAcpEventTranslator(provider.generateId)
    let cancelled = false
    let stream = new ReadableStream<LanguageModelV2StreamPart>({
      async start(controller) {
        try {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          for await (const event of turn.events) {
            if (cancelled) return
            for (const part of translator.translate(event))
              controller.enqueue(part)
          }
          const result = await turn.result
          if (!cancelled)
            for (const part of translator.finish(result))
              controller.enqueue(part)
        } catch (error) {
          if (!cancelled) {
            for (const part of translator.finish({
              status: 'failed',
              error: {
                message: error instanceof Error ? error.message : String(error),
              },
            }))
              controller.enqueue(part)
          }
        } finally {
          if (!cancelled) controller.close()
        }
      },
      async cancel(reason) {
        cancelled = true
        await turn.cancel({ reason: String(reason ?? 'Stream cancelled') })
      },
    })
    if (options.responseFormat?.type === 'json')
      stream = stream.pipeThrough(createJsonCleanupTransform())
    return {
      stream,
      request: { body: { agent: this.modelId, sessionKey } },
      response: { headers: {} },
    }
  }
}
