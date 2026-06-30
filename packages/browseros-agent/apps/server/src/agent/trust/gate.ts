import {
  type ConsequenceClass,
  decideGate,
  deriveClass,
  type GateContext,
  isConsequentialClass,
  isPinActive,
  isPromoted,
  PROMOTED_ARG,
  recordConsequentialExecution,
  stripPromotedArg,
} from '@browseros/shared/trust/consequence-class'
import { type Tool, tool } from 'ai'
import { z } from 'zod'
import { logGateDecision } from './action-log'

export type { ConsequenceClass, GateContext }

export type GateToolResult =
  | { text: string; isError?: boolean }
  | { content: Array<{ type: string; text?: string }>; isError?: boolean }

export type GateContextProvider = () => GateContext

function toTextResult(preview: string, isError = false): GateToolResult {
  return { text: preview, isError }
}

function toContentResult(preview: string, isError = false): GateToolResult {
  return {
    content: [{ type: 'text', text: preview }],
    isError,
  }
}

function formatGateResult(
  preview: string,
  shape: 'text' | 'content',
  isError = false,
): GateToolResult {
  return shape === 'content'
    ? toContentResult(preview, isError)
    : toTextResult(preview, isError)
}

/** Executes a tool call through the trust gate (MCP / non-approval path). */
export async function gateExecute<TResult extends GateToolResult>(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
  underlyingExecute: (args: Record<string, unknown>) => Promise<TResult>,
  resultShapeKind: 'text' | 'content' = 'text',
): Promise<TResult> {
  const decision = decideGate(toolName, args, ctx)
  const cls = deriveClass(toolName, args, ctx)

  if (decision.action === 'blast-radius-cap') {
    logGateDecision(toolName, args, ctx, cls, 'denied', decision.preview)
    return formatGateResult(decision.preview, resultShapeKind) as TResult
  }

  if (decision.action === 'dry-run') {
    logGateDecision(toolName, args, ctx, cls, 'dry-run', decision.preview)
    return formatGateResult(decision.preview, resultShapeKind) as TResult
  }

  if (decision.action === 'needs-approval') {
    const preview = buildLoopApprovalPreview(toolName, args)
    logGateDecision(toolName, args, ctx, cls, 'approval-requested', preview)
    return formatGateResult(preview, resultShapeKind) as TResult
  }

  const cleanArgs = stripPromotedArg(args)
  const result = await underlyingExecute(cleanArgs)
  recordConsequentialExecution(ctx, cls)
  if (isConsequentialClass(cls)) {
    const summary =
      'text' in result && typeof result.text === 'string'
        ? result.text
        : undefined
    logGateDecision(
      toolName,
      args,
      ctx,
      cls,
      isPromoted(args) ? 'promoted' : 'executed',
      summary,
    )
  }
  return result
}

function buildLoopApprovalPreview(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === 'filesystem_write' || toolName === 'filesystem_edit') {
    const path = typeof args.path === 'string' ? args.path : '(unknown path)'
    return `Needs approval: write ${path}.`
  }
  return 'Needs approval.'
}

/** Wraps an AI SDK tool with the trust gate. */
export function wrapToolWithGate<T extends Tool>(
  toolName: string,
  original: T,
  ctxProvider: GateContextProvider,
): T {
  const shape = toolName.startsWith('filesystem_') ? 'text' : 'content'
  const inputSchema =
    'inputSchema' in original && original.inputSchema
      ? (original.inputSchema as z.ZodObject<z.ZodRawShape>).extend({
          [PROMOTED_ARG]: z.boolean().optional(),
        })
      : z.object({ [PROMOTED_ARG]: z.boolean().optional() })

  const wrapped = tool({
    description: original.description,
    inputSchema,
    needsApproval: async (input) => {
      const ctx = { ...ctxProvider(), surface: 'loop' as const }
      const args = input as Record<string, unknown>
      const cls = deriveClass(toolName, args, ctx)
      if (cls !== 'write-local') return false
      if (isPromoted(args) || isPinActive(ctx, cls)) return false
      logGateDecision(
        toolName,
        args,
        ctx,
        cls,
        'approval-requested',
        buildLoopApprovalPreview(toolName, args),
      )
      return true
    },
    execute: async (input, options) => {
      const ctx = { ...ctxProvider(), surface: 'loop' as const }
      const args = input as Record<string, unknown>
      const decision = decideGate(toolName, args, ctx)
      const cls = deriveClass(toolName, args, ctx)

      if (decision.action === 'blast-radius-cap') {
        logGateDecision(toolName, args, ctx, cls, 'denied', decision.preview)
        return formatGateResult(decision.preview, shape) as Awaited<
          ReturnType<NonNullable<T['execute']>>
        >
      }

      if (decision.action === 'dry-run') {
        logGateDecision(toolName, args, ctx, cls, 'dry-run', decision.preview)
        return formatGateResult(decision.preview, shape) as Awaited<
          ReturnType<NonNullable<T['execute']>>
        >
      }

      if (!original.execute) {
        throw new Error(`Tool ${toolName} has no execute function`)
      }

      const cleanArgs = stripPromotedArg(args)
      const result = await original.execute(cleanArgs, options)
      if (isConsequentialClass(cls)) {
        recordConsequentialExecution(ctx, cls)
        const output = result as {
          text?: string
          content?: Array<{ type?: string; text?: string }>
        }
        const summary =
          output.text ??
          output.content
            ?.filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n')
        logGateDecision(
          toolName,
          args,
          ctx,
          cls,
          isPromoted(args) ? 'promoted' : 'executed',
          summary,
        )
      }
      return result
    },
    ...(original.toModelOutput
      ? { toModelOutput: original.toModelOutput }
      : {}),
  })

  return wrapped as T
}

/** Wraps all tools in a ToolSet with the trust gate. */
export function wrapToolSetWithGate(
  tools: Record<string, Tool>,
  ctxProvider: GateContextProvider,
): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {}
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = wrapToolWithGate(name, t, ctxProvider)
  }
  return wrapped
}
