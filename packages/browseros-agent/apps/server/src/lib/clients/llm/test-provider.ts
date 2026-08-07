/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { TIMEOUTS } from '@browseros/shared/constants/timeouts'
import type { LLMConfig } from '@browseros/shared/schemas/llm'
import { streamText } from 'ai'
import { resolveLLMConfig } from './config'
import { createLLMProvider } from './provider'

export interface ProviderTestConfig extends LLMConfig {
  model: string
  upstreamProvider?: string
}

export interface ProviderTestResult {
  success: boolean
  message: string
  responseTime?: number
}

const TEST_PROMPT = "Respond with exactly: 'ok'"

export async function testProviderConnection(
  config: ProviderTestConfig,
  browserosId?: string,
): Promise<ProviderTestResult> {
  const startTime = performance.now()

  try {
    const resolvedConfig = await resolveLLMConfig(config, browserosId)
    const model = createLLMProvider(resolvedConfig)

    // streamText works for all providers including Codex (which requires streaming)
    const stream = streamText({
      model,
      messages: [{ role: 'user', content: TEST_PROMPT }],
      abortSignal: AbortSignal.timeout(TIMEOUTS.TEST_PROVIDER),
    })
    // await stream.text rejects on provider errors (verified against
    // ai@6.0.209 with both a connection-refused and a real HTTP 401):
    // unlike stream.textStream, it does not silently resolve to '' when
    // the provider fails before streaming any token.
    const text = await stream.text
    const responseTime = Math.round(performance.now() - startTime)

    if (text) {
      const preview = text.length > 100 ? `${text.slice(0, 100)}...` : text
      return {
        success: true,
        message: `Connection successful. Response: "${preview}"`,
        responseTime,
      }
    }

    return {
      success: true,
      message: 'Connection successful. Provider responded.',
      responseTime,
    }
  } catch (error) {
    const responseTime = Math.round(performance.now() - startTime)
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      success: false,
      message: `[${config.provider}] ${errorMessage}`,
      responseTime,
    }
  }
}
