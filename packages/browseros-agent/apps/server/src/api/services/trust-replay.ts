import type { Browser } from '@browseros/browser-core/browser'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { createBrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import type {
  ConsequenceClass,
  GateContext,
  TrustPin,
} from '@browseros/shared/trust/consequence-class'
import {
  deriveClass,
  PROMOTED_ARG,
} from '@browseros/shared/trust/consequence-class'
import type { Tool } from 'ai'
import { buildAgentFilesystemToolSet } from '../../agent/ai-sdk-agent'
import { buildBrowserToolSet } from '../../agent/tool-adapter'
import { type GateToolResult, gateExecute } from '../../agent/trust/gate'
import type { ResolvedAgentConfig } from '../../agent/types'
import { defaultWorkspace } from '../../tools/filesystem/workspace'
import type { BrowserContext } from '../types'

export interface ReplayToolRequest {
  toolName: string
  args: Record<string, unknown>
  conversationId?: string
  userWorkingDir?: string
  workspaceId?: string
  bucketId?: string
  trustPins?: Partial<Record<ConsequenceClass, TrustPin>>
  browserContext?: BrowserContext
}

export interface ReplayToolResult {
  toolName: string
  consequenceClass: string
  decision: 'executed' | 'promoted' | 'dry-run' | 'denied'
  output: unknown
  isError: boolean
}

export interface TrustReplayDeps {
  browser: Browser
  browserSession: BrowserSession
  browserosId?: string
}

function buildGateContext(request: ReplayToolRequest): GateContext {
  const pins = request.trustPins ?? {}
  return {
    pins,
    browserContext: request.browserContext,
    workspaceRoot: request.userWorkingDir,
    runConsequentialCount: { count: 0 },
    isNewUser: Object.keys(pins).length === 0,
    surface: 'loop',
    conversationId: request.conversationId,
  }
}

function buildResolvedConfig(request: ReplayToolRequest): ResolvedAgentConfig {
  const workingDir = request.userWorkingDir
  return {
    provider: 'openai',
    model: 'replay',
    conversationId: request.conversationId ?? crypto.randomUUID(),
    workspace: workingDir
      ? defaultWorkspace(workingDir, {
          bucketId: request.bucketId ?? 'default',
          workspaceId: request.workspaceId,
        })
      : undefined,
    workingDir,
    chatMode: false,
    isScheduledTask: false,
    origin: 'sidepanel',
  }
}

function buildReplayToolSet(
  deps: TrustReplayDeps,
  request: ReplayToolRequest,
): Record<string, Tool> {
  const resolvedConfig = buildResolvedConfig(request)
  const outputFileAccess = createBrowserOutputFileAccess()

  const filesystemTools = buildAgentFilesystemToolSet(resolvedConfig, {
    outputFileAccess,
  })
  const browserTools = buildBrowserToolSet(deps.browserSession, {
    outputFileAccess,
  })

  return { ...browserTools, ...filesystemTools }
}

function resultShape(toolName: string): 'text' | 'content' {
  return toolName.startsWith('filesystem_') ? 'text' : 'content'
}

function inferDecisionFromOutput(output: {
  text?: string
  content?: Array<{ type?: string; text?: string }>
}): ReplayToolResult['decision'] {
  const text =
    output.text ??
    output.content
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ??
    ''
  if (text.includes('Blast-radius cap')) return 'denied'
  if (text.startsWith('Dry-run.') || text.startsWith('Needs approval:')) {
    return 'dry-run'
  }
  return 'promoted'
}

/** Re-executes a gated tool call with `__promoted: true` (replay / promote path). */
export async function replayToolCall(
  deps: TrustReplayDeps,
  request: ReplayToolRequest,
  abortSignal?: AbortSignal,
): Promise<ReplayToolResult> {
  const tools = buildReplayToolSet(deps, request)
  const tool = tools[request.toolName]
  if (!tool?.execute) {
    throw new Error(`Unknown or non-executable tool: ${request.toolName}`)
  }

  const gateContext = buildGateContext(request)
  const args = { ...request.args, [PROMOTED_ARG]: true }
  const shape = resultShape(request.toolName)
  const execute = tool.execute
  if (!execute) {
    throw new Error(`Tool ${request.toolName} has no execute handler`)
  }

  const output = await gateExecute(
    request.toolName,
    args,
    gateContext,
    (cleanArgs) =>
      execute(cleanArgs, {
        abortSignal,
        toolCallId: `replay-${crypto.randomUUID()}`,
        messages: [],
      }) as Promise<GateToolResult>,
    shape,
  )

  const cls = deriveClass(request.toolName, request.args, gateContext)
  const decision = inferDecisionFromOutput(output)

  return {
    toolName: request.toolName,
    consequenceClass: cls,
    decision,
    output,
    isError: Boolean(output.isError),
  }
}
