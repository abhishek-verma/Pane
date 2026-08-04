import {
  decideGate,
  deriveClass,
  describeToolCall,
  type GateContext,
  isConsequentialClass,
  PROMOTED_ARG,
  recordConsequentialExecution,
  stripPromotedArg,
} from '@browseros/shared/trust/consequence-class'

export type GateContextProvider = () => GateContext

export interface McpGateResult {
  content: unknown
  isError?: boolean
  structuredContent?: unknown
}

/** Applies the trust gate to an MCP tool handler (preview/promote path). */
export async function gateMcpHandler(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
  underlying: (args: Record<string, unknown>) => Promise<McpGateResult>,
): Promise<McpGateResult> {
  const gatedCtx = { ...ctx, surface: 'mcp' as const }
  const decision = decideGate(toolName, args, gatedCtx)
  const cls = deriveClass(toolName, args, gatedCtx)

  if (decision.action === 'blast-radius-cap') {
    return {
      content: [{ type: 'text', text: decision.preview }],
      isError: false,
    }
  }

  if (decision.action === 'dry-run') {
    if (ctx.requestApproval) {
      const resolution = await ctx.requestApproval({
        toolName,
        args,
        consequenceClass: cls,
        preview: describeToolCall(toolName, args),
      })
      if (resolution === 'approved') {
        // Server (not the model) sets __promoted after a human resolved it —
        // re-run through the gate so execute/record/logging stay one path.
        return gateMcpHandler(
          toolName,
          { ...args, [PROMOTED_ARG]: true },
          ctx,
          underlying,
        )
      }
      const text =
        resolution === 'denied'
          ? `Denied: ${describeToolCall(toolName, args)}`
          : `Approval timed out: ${describeToolCall(toolName, args)}`
      return { content: [{ type: 'text', text }], isError: true }
    }
    return {
      content: [{ type: 'text', text: decision.preview }],
      isError: false,
    }
  }

  const cleanArgs = stripPromotedArg(args)
  const result = await underlying(cleanArgs)
  if (isConsequentialClass(cls)) {
    recordConsequentialExecution(gatedCtx, cls)
  }
  return result
}

export function createDefaultMcpGateContext(
  overrides: Partial<GateContext> = {},
): GateContext {
  return {
    pins: {},
    runConsequentialCount: { count: 0 },
    isNewUser: true,
    surface: 'mcp',
    ...overrides,
  }
}
