import {
  decideGate,
  deriveClass,
  type GateContext,
  isConsequentialClass,
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
