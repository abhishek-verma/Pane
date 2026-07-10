import {
  type ConsequenceClass,
  decideGate,
  deriveClass,
  describeToolCall,
  type GateContext,
  getBlastRadiusCap,
  isConsequentialClass,
  isPinActive,
  isPromoted,
  recordConsequentialExecution,
  stripPromotedArg,
} from '@browseros/shared/trust/consequence-class'
import { type Tool, tool } from 'ai'
import { z } from 'zod'
import {
  channelOutcomeKey,
  getChannelOutcome,
  requestChannelApproval,
  setChannelOutcome,
} from '../../scheduler/approvals'
import {
  appendCompletedStep,
  getScheduledRun,
  shouldSkipCompletedStep,
  stepFingerprint,
} from '../../scheduler/run-executor'
import { logGateDecision } from './action-log'

/** Prefer run idempotency key so retries with a new chat runId still dedupe. */
export function resolveStepIdempotencyKey(ctx: GateContext): string {
  if (ctx.idempotencyKey) return ctx.idempotencyKey
  if (ctx.scheduledRunId) {
    const run = getScheduledRun(ctx.scheduledRunId)
    if (run?.idempotencyKey) return run.idempotencyKey
  }
  return ctx.runId ?? 'unattended'
}

function skipIfCompletedStep(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
  cls: ConsequenceClass,
  resultShapeKind: 'text' | 'content',
): GateToolResult | null {
  if (!ctx.scheduledRunId || !isConsequentialClass(cls)) return null
  const run = getScheduledRun(ctx.scheduledRunId)
  if (!run) return null
  const fp = stepFingerprint(toolName, args, resolveStepIdempotencyKey(ctx))
  if (!shouldSkipCompletedStep(run, fp, cls)) return null
  const preview = `Skipped (already completed): ${describeToolCall(toolName, args)}`
  logGateDecision(toolName, args, ctx, cls, 'executed', preview)
  return formatGateResult(preview, resultShapeKind)
}

function isToolErrorResult(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === 'object' &&
      'isError' in result &&
      (result as { isError?: boolean }).isError === true,
  )
}

function recordCompletedStep(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
  cls: ConsequenceClass,
  toolCallId?: string,
): void {
  if (!ctx.scheduledRunId || !isConsequentialClass(cls)) return
  const fp = stepFingerprint(toolName, args, resolveStepIdempotencyKey(ctx))
  appendCompletedStep(ctx.scheduledRunId, {
    toolCallId: toolCallId ?? fp,
    toolName,
    class: cls,
    fingerprint: fp,
  })
}

export type { ConsequenceClass, GateContext }

export type GateToolResult =
  | { text: string; isError?: boolean }
  | { content: Array<{ type: string; text?: string }>; isError?: boolean }

export type GateContextProvider = () => GateContext

/** Fired after a tool actually executes (post-gate). Server-only; used for graph ingest. */
export interface ToolSettledInfo {
  toolName: string
  args: Record<string, unknown>
  result: unknown
  ctx: GateContext
}

export type OnToolSettled = (info: ToolSettledInfo) => void

export interface GateHooks {
  onToolSettled?: OnToolSettled
}

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
  hooks?: GateHooks,
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

  const skipped = skipIfCompletedStep(toolName, args, ctx, cls, resultShapeKind)
  if (skipped) return skipped as TResult

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
    if (!isToolErrorResult(result)) {
      recordCompletedStep(toolName, args, ctx, cls)
    }
  }
  hooks?.onToolSettled?.({ toolName, args: cleanArgs, result, ctx })
  return result
}

function buildLoopApprovalPreview(
  toolName: string,
  args: Record<string, unknown>,
): string {
  return `Needs approval: ${describeToolCall(toolName, args)}`
}

/**
 * Wraps an AI SDK tool with the trust gate for the in-process agent loop.
 *
 * Loop-surface semantics (the model is the caller):
 * - `__promoted` is intentionally NOT exposed in the tool schema. The model
 *   must never be able to self-promote, so promotion happens only through
 *   user approval (the SDK re-invokes `execute` after approval) or pins.
 * - Every consequential class pauses via `needsApproval` rather than
 *   returning a dry-run preview to the model. This keeps the model's context
 *   honest: it never continues on the assumption that an action ran.
 * - The blast-radius cap is enforced here (auto-execution via a pin pauses
 *   once the cap is reached). Explicit approvals bypass the cap.
 */
export function wrapToolWithGate<T extends Tool>(
  toolName: string,
  original: T,
  ctxProvider: GateContextProvider,
  hooks?: GateHooks,
): T {
  const inputSchema =
    'inputSchema' in original && original.inputSchema
      ? (original.inputSchema as z.ZodObject<z.ZodRawShape>)
      : z.object({})

  const wrapped = tool({
    description: original.description,
    inputSchema,
    needsApproval: async (input) => {
      const ctx = { ...ctxProvider(), surface: 'loop' as const }
      const args = input as Record<string, unknown>
      const cls = deriveClass(toolName, args, ctx)
      if (!isConsequentialClass(cls)) return false
      if (isPromoted(args)) return false
      if (
        isPinActive(ctx, cls) &&
        ctx.runConsequentialCount.count < getBlastRadiusCap(ctx)
      ) {
        return false
      }

      const preview = buildLoopApprovalPreview(toolName, args)

      // Unattended: pause via channel, never auto-approve on silence.
      if (ctx.unattended) {
        const runId = ctx.runId ?? 'unattended'
        const fp = stepFingerprint(
          toolName,
          args,
          resolveStepIdempotencyKey(ctx),
        )
        const { resolution } = await requestChannelApproval({
          runId,
          conversationId: ctx.conversationId,
          toolCallId: fp,
          toolName,
          consequenceClass: cls,
          preview,
        })
        setChannelOutcome(channelOutcomeKey(runId, toolName, fp), resolution)
        logGateDecision(
          toolName,
          args,
          ctx,
          cls,
          resolution === 'approved' ? 'approval-requested' : 'denied',
          resolution === 'approved'
            ? preview
            : `Channel ${resolution}: ${preview}`,
        )
        // Return false so execute runs; execute checks channel outcome.
        // Approved → execute; denied/timeout → execute returns error (no side effect).
        return false
      }

      logGateDecision(toolName, args, ctx, cls, 'approval-requested', preview)
      return true
    },
    execute: async (input, options) => {
      const ctx = { ...ctxProvider(), surface: 'loop' as const }
      const args = input as Record<string, unknown>
      const cls = deriveClass(toolName, args, ctx)

      if (!original.execute) {
        throw new Error(`Tool ${toolName} has no execute function`)
      }

      if (ctx.unattended && isConsequentialClass(cls) && !isPromoted(args)) {
        const runId = ctx.runId ?? 'unattended'
        const fp = stepFingerprint(
          toolName,
          args,
          resolveStepIdempotencyKey(ctx),
        )
        const outcome = getChannelOutcome(
          channelOutcomeKey(runId, toolName, fp),
        )
        if (outcome === 'denied' || outcome === 'timeout') {
          const msg =
            outcome === 'denied'
              ? 'Denied via reach channel. Run cancelled for this action.'
              : 'Approval timed out. Action skipped (never auto-approved).'
          logGateDecision(toolName, args, ctx, cls, 'denied', msg)
          return { text: msg, isError: true }
        }
        if (outcome === 'approved') {
          // Channel approve resumes through the same execute path as pin/promote.
          // We do not set __promoted on the schema — outcome map is the proof.
        } else if (
          !isPinActive(ctx, cls) ||
          ctx.runConsequentialCount.count >= getBlastRadiusCap(ctx)
        ) {
          // Unattended without a resolved channel outcome and no pin — refuse.
          const msg =
            'Unattended consequential action blocked (no channel approval).'
          logGateDecision(toolName, args, ctx, cls, 'denied', msg)
          return { text: msg, isError: true }
        }
      }

      const skipped = skipIfCompletedStep(toolName, args, ctx, cls, 'text')
      if (skipped) return skipped

      // A consequential call reaches execute only after the user approved
      // (the SDK re-invokes us) or because a pin allowed auto-execution.
      // Either way it is authorized — run it. Reads always run.
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
        const runId = ctx.runId ?? 'unattended'
        const fp = stepFingerprint(
          toolName,
          args,
          resolveStepIdempotencyKey(ctx),
        )
        const channelApproved =
          getChannelOutcome(channelOutcomeKey(runId, toolName, fp)) ===
          'approved'
        logGateDecision(
          toolName,
          args,
          ctx,
          cls,
          isPromoted(args) || channelApproved ? 'promoted' : 'executed',
          summary,
        )
        if (!isToolErrorResult(result)) {
          recordCompletedStep(
            toolName,
            args,
            ctx,
            cls,
            typeof options?.toolCallId === 'string'
              ? options.toolCallId
              : undefined,
          )
        }
      }
      hooks?.onToolSettled?.({ toolName, args: cleanArgs, result, ctx })
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
  hooks?: GateHooks,
): Record<string, Tool> {
  const wrapped: Record<string, Tool> = {}
  for (const [name, t] of Object.entries(tools)) {
    wrapped[name] = wrapToolWithGate(name, t, ctxProvider, hooks)
  }
  return wrapped
}
