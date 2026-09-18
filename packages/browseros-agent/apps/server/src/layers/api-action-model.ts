import { APICallError, generateText, streamText, type ToolSet } from 'ai'
import { resolveLLMConfig } from '../lib/clients/llm/config'
import { createLLMProvider } from '../lib/clients/llm/provider'
import { LayerActionError } from './action-error'
import type { TranslationRun } from './action-runner'

type ActionGenerationOptions = Pick<
  Parameters<typeof generateText<ToolSet>>[0],
  'system' | 'tools' | 'stopWhen' | 'maxOutputTokens'
> & { prompt: string }

/** Provider-owned model IDs are opaque. Use the saved route, native wire
 * protocol, and private tool validators; never authorize by a response label. */
export async function runApiActionModel(
  run: TranslationRun,
  options: ActionGenerationOptions,
): Promise<void> {
  try {
    const model = createLLMProvider(
      await resolveLLMConfig(run.config, run.binding.profileId),
    )
    const settings = {
      ...options,
      model,
      toolChoice: 'auto' as const,
      maxRetries: 0,
      abortSignal: run.signal,
    }
    let outputTokens: number | undefined
    if (run.config.provider === 'chatgpt-pro') {
      // The account endpoint is streaming-only. Its fetch adapter also removes
      // output ceilings, so validate reported usage before accepting any result.
      const result = streamText(settings)
      for await (const part of result.fullStream) {
        if (part.type === 'error') throw part.error
      }
      outputTokens = (await result.totalUsage).outputTokens
      if (outputTokens === undefined)
        throw new LayerActionError('PROVIDER_OUTPUT_BUDGET')
    } else {
      outputTokens = (await generateText(settings)).totalUsage.outputTokens
    }
    if (
      outputTokens !== undefined &&
      (!Number.isFinite(outputTokens) ||
        outputTokens < 0 ||
        outputTokens > run.action.limits.maxOutputTokens)
    )
      throw new LayerActionError('PROVIDER_OUTPUT_BUDGET')
  } catch (error) {
    if (APICallError.isInstance(error)) {
      const code =
        error.statusCode === 401
          ? 'API_AUTH_REQUIRED'
          : error.statusCode === 429
            ? 'API_RATE_LIMITED'
            : error.statusCode !== undefined &&
                error.statusCode >= 400 &&
                error.statusCode < 500
              ? 'API_REQUEST_REJECTED'
              : 'API_UNAVAILABLE'
      throw new LayerActionError(code)
    }
    throw error
  }
}
