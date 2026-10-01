import {
  APICallError,
  type LanguageModelV3CallOptions,
  type LanguageModelV3Middleware,
} from '@ai-sdk/provider'
import type { ToolSet } from 'ai'
import { logger } from '../lib/logger'

const MAX_TOOL_REMOVALS = 3

/** Only recover an explicit, named schema rejection of an advertised function.
 * Never guess from generic 400s, auth failures, context limits, or tool results.
 */
function rejectedTool(
  error: unknown,
  params: LanguageModelV3CallOptions,
): string | undefined {
  if (
    !APICallError.isInstance(error) ||
    ![400, 422].includes(error.statusCode ?? 0)
  )
    return
  const name =
    /Invalid schema for (?:function|tool)\s+['"`]([^'"`]+)['"`]/i.exec(
      error.message,
    )?.[1]
  if (
    name &&
    params.tools?.some((t) => t.type === 'function' && t.name === name)
  )
    return name
  return undefined
}

/** One controller per agent/model session, so a rejected tool is not advertised
 * again on each loop step or turn. Rebuilding/switching the agent resets it.
 */
export function createToolSchemaRecovery() {
  const unavailable = new Set<string>()

  function prepare(
    params: LanguageModelV3CallOptions,
    textOnly = false,
  ): LanguageModelV3CallOptions {
    if (!textOnly && unavailable.size === 0) return params
    const tools = textOnly
      ? []
      : params.tools?.filter(
          (t) => t.type !== 'function' || !unavailable.has(t.name),
        )
    const choice = params.toolChoice
    const toolChoice = !tools?.length
      ? { type: 'none' as const }
      : choice?.type === 'tool' && unavailable.has(choice.toolName)
        ? { type: 'auto' as const }
        : choice
    const notice = textOnly
      ? 'Tools are unavailable for this response because the provider rejected multiple tool definitions. Reply without tools.'
      : `These tools are temporarily unavailable because the provider rejected their definitions: ${[...unavailable].join(', ')}. Do not call them.`
    const content = `${notice} Use other available capabilities if helpful. If the request needs an unavailable tool, explain the limitation; do not claim you performed that action. Mention this limitation only when relevant to the user’s request.`
    const prompt = [...params.prompt]
    const index = prompt.findIndex((m) => m.role === 'system')
    const system = prompt[index]
    if (system?.role === 'system')
      prompt[index] = { ...system, content: `${system.content}\n\n${content}` }
    else prompt.unshift({ role: 'system', content })
    return { ...params, tools, toolChoice, prompt }
  }

  async function recover<T>(
    params: LanguageModelV3CallOptions,
    call: (options: LanguageModelV3CallOptions) => PromiseLike<T>,
  ): Promise<T> {
    for (let removals = 0; ; removals++) {
      params.abortSignal?.throwIfAborted()
      const attempt = prepare(params)
      try {
        return await call(attempt)
      } catch (error) {
        params.abortSignal?.throwIfAborted()
        const name = rejectedTool(error, attempt)
        if (!name) throw error
        unavailable.add(name)
        logger.warn(
          'Provider rejected tool schema; disabling tool for this agent session',
          { toolName: name },
        )
        if (removals >= MAX_TOOL_REMOVALS) {
          // One final, tool-free response lets the agent explain the limitation
          // instead of letting an arbitrarily large broken inventory kill chat.
          return await call(prepare(params, true))
        }
      }
    }
  }

  const middleware: LanguageModelV3Middleware = {
    specificationVersion: 'v3',
    wrapGenerate: ({ model, params }) =>
      recover(params, (p) => model.doGenerate(p)),
    // Only retry request rejection BEFORE a stream is returned. Never replay
    // an established stream: it may already have emitted text or tool calls.
    wrapStream: ({ model, params }) =>
      recover(params, (p) => model.doStream(p)),
  }

  function protectTools(tools: ToolSet): ToolSet {
    return Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => {
        const execute = tool.execute
        return [
          name,
          execute
            ? {
                ...tool,
                execute: async (
                  ...args: Parameters<NonNullable<typeof execute>>
                ) => {
                  // A model may remember an old definition from history. Do not execute
                  // a quarantined tool even if it emits a stale call; SDK returns this
                  // ordinary execution error to the model for the next loop step.
                  if (unavailable.has(name))
                    throw new Error(
                      `Tool ${name} is temporarily unavailable: the provider rejected its input schema. Use another available tool or explain the limitation.`,
                    )
                  return execute(...args)
                },
              }
            : tool,
        ]
      }),
    )
  }

  return { middleware, protectTools }
}
