/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * experimental_repairToolCall: when a tool call's JSON fails to parse or
 * fails its Zod schema, re-ask the same model once for corrected JSON before
 * giving up the step. Scoped to InvalidToolInputError only — a NoSuchToolError
 * (model invented a tool name) is not a JSON problem and is not repairable
 * this way. See apps/server/src/agent/durable-agent-ui-stream.ts for the
 * user-facing message shown when repair also fails.
 */

import type { LanguageModelV3ToolCall } from '@ai-sdk/provider'
import {
  InvalidToolInputError,
  type ToolCallRepairFunction,
  type ToolSet,
} from 'ai'
import { logger } from '../lib/logger'

type GenerateTextFn = (options: {
  model: unknown
  system?: unknown
  prompt: string
}) => Promise<{ text: string }>

/** Repair a tool call's JSON by re-asking the same model for corrected JSON. */
export function createRepairToolCall<TOOLS extends ToolSet>(deps: {
  generateText: GenerateTextFn
  model?: unknown
}): ToolCallRepairFunction<TOOLS> {
  return async ({ system, toolCall, inputSchema, error }) => {
    if (!(error instanceof InvalidToolInputError)) return null

    let schema: unknown = null
    try {
      schema = await inputSchema({ toolName: toolCall.toolName })
    } catch {
      schema = null
    }
    const prompt = [
      `A previous tool call to "${toolCall.toolName}" had invalid JSON input and failed to parse.`,
      'Broken input:',
      toolCall.input,
      'Error:',
      error.message,
      schema ? `Expected JSON Schema:\n${JSON.stringify(schema)}` : undefined,
      'Reply with ONLY the corrected, valid JSON for this tool call — no prose, no markdown fences.',
    ]
      .filter((line): line is string => line != null)
      .join('\n\n')

    let repairedText: string
    try {
      const result = await deps.generateText({
        model: deps.model,
        system,
        prompt,
      })
      repairedText = result.text.trim()
    } catch (err) {
      logger.warn('repairToolCall: re-ask generation failed', {
        toolName: toolCall.toolName,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }

    try {
      JSON.parse(repairedText)
    } catch {
      logger.warn('repairToolCall: re-ask still produced invalid JSON', {
        toolName: toolCall.toolName,
      })
      return null
    }

    const repaired: LanguageModelV3ToolCall = {
      ...toolCall,
      input: repairedText,
    }
    return repaired
  }
}
