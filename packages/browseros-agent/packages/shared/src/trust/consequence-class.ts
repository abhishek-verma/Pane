import type { BrowserContext } from '../schemas/browser-context'

export type ConsequenceClass =
  | 'read'
  | 'write-local'
  | 'system'
  | 'write-external'
  | 'spend'

export const PROMOTED_ARG = '__promoted' as const

export const BLAST_RADIUS_CAP_NEW_USER = 1
export const BLAST_RADIUS_CAP_PINNED = 10

const CONSEQUENTIAL_CLASSES = new Set<ConsequenceClass>([
  'write-local',
  'system',
  'write-external',
  'spend',
])

const READ_FILESYSTEM_TOOLS = new Set([
  'filesystem_read',
  'filesystem_ls',
  'filesystem_grep',
  'filesystem_find',
  'terminal_sessions',
])

const READ_BROWSER_TOOLS = new Set([
  'snapshot',
  'screenshot',
  'read',
  'grep',
  'diff',
  'pdf',
  'wait',
  'navigate',
])

// Tools that execute arbitrary code (page-context JS or an async JS body).
// These can mutate the page, exfiltrate credentials, and click elements, so
// they must never auto-execute. Treat them like shell commands: `system`.
const CODE_EXECUTION_TOOLS = new Set(['evaluate', 'run'])

// Tools that move files across the local-disk / remote-site trust boundary.
// `upload` reads arbitrary local files and sends them to a remote site
// (exfiltration primitive); `download` writes a fetched file to disk. Both
// are gated as `write-external`.
const EXTERNAL_DATA_TOOLS = new Set(['upload', 'download'])

const NUDGE_TOOLS = new Set(['suggest_schedule', 'suggest_app_connection'])

const READ_CONTEXT_TOOLS = new Set([
  'context_current_work',
  'context_search',
  'context_recall',
  'tasks_list',
  'skills_load',
  'skills_list',
  'home_widget_list',
  'home_widget_propose',
])

const WRITE_LOCAL_TASK_TOOLS = new Set([
  'tasks_add',
  'tasks_done',
  'memory_add',
  'memory_replace',
  'memory_remove',
  'skills_install',
  'skills_archive',
  'capture_start',
  'capture_stop',
  'home_widget_add',
  'home_widget_remove',
])

const READ_CAPTURE_TOOLS = new Set([
  'capture_status',
  'capture_list',
  'capture_read',
])

const PAYMENT_HOST_KEYWORDS = [
  'pay',
  'checkout',
  'bank',
  'stripe',
  'paypal',
] as const

const MUTATING_ACT_KINDS = new Set([
  'click',
  'click_at',
  'type',
  'type_at',
  'fill',
  'press',
  'check',
  'uncheck',
  'select',
  'drag',
  'drag_at',
])

/** Observation gestures — do not mutate form state or navigate. */
const READ_ACT_KINDS = new Set(['scroll', 'hover', 'hover_at', 'focus'])

export interface TrustPin {
  pinned: boolean
  expiresAt?: number
}

export interface GateContext {
  pins: Partial<Record<ConsequenceClass, TrustPin>>
  browserContext?: Pick<BrowserContext, 'activeTab' | 'isPrivate'>

  workspaceRoot?: string
  runConsequentialCount: { count: number }
  isNewUser: boolean
  surface: 'loop' | 'mcp'
  runId?: string
  conversationId?: string
  /** Scheduled / trigger / keep-alive runs — approval goes over reach. */
  unattended?: boolean
  /** Server scheduled_runs id when executing a drained trigger/keep-alive run. */
  scheduledRunId?: string
  /** Stable key for consequential step dedupe (prefer over chat runId). */
  idempotencyKey?: string
}

export function isConsequentialClass(cls: ConsequenceClass): boolean {
  return CONSEQUENTIAL_CLASSES.has(cls)
}

export function isPinActive(ctx: GateContext, cls: ConsequenceClass): boolean {
  const pin = ctx.pins[cls]
  if (!pin?.pinned) return false
  if (pin.expiresAt != null && Date.now() >= pin.expiresAt) return false
  return true
}

export function getBlastRadiusCap(ctx: GateContext): number {
  const hasAnyPin = Object.values(ctx.pins).some(
    (pin) =>
      pin?.pinned && (pin.expiresAt == null || Date.now() < pin.expiresAt),
  )
  return hasAnyPin ? BLAST_RADIUS_CAP_PINNED : BLAST_RADIUS_CAP_NEW_USER
}

export function isPromoted(args: Record<string, unknown>): boolean {
  return args[PROMOTED_ARG] === true
}

function baseClassForTool(
  toolName: string,
  args: Record<string, unknown>,
): ConsequenceClass {
  if (READ_FILESYSTEM_TOOLS.has(toolName)) return 'read'
  if (READ_CONTEXT_TOOLS.has(toolName)) return 'read'
  if (READ_CAPTURE_TOOLS.has(toolName)) return 'read'
  if (WRITE_LOCAL_TASK_TOOLS.has(toolName)) return 'write-local'
  if (toolName === 'filesystem_write' || toolName === 'filesystem_edit') {
    return 'write-local'
  }
  if (toolName === 'filesystem_bash') return 'system'
  if (NUDGE_TOOLS.has(toolName)) return 'read'

  if (toolName === 'tabs') {
    const action = typeof args.action === 'string' ? args.action : 'list'
    if (action === 'list' || action === 'active') return 'read'
    return 'write-external'
  }

  if (toolName === 'tab_groups') {
    const action = typeof args.action === 'string' ? args.action : 'list'
    if (action === 'list') return 'read'
    return 'write-external'
  }

  if (toolName === 'windows') {
    const action = typeof args.action === 'string' ? args.action : 'list'
    if (action === 'list') return 'read'
    return 'write-external'
  }

  if (CODE_EXECUTION_TOOLS.has(toolName)) return 'system'
  if (EXTERNAL_DATA_TOOLS.has(toolName)) return 'write-external'
  if (READ_BROWSER_TOOLS.has(toolName)) return 'read'
  if (toolName === 'act') {
    const kind = typeof args.kind === 'string' ? args.kind : ''
    if (READ_ACT_KINDS.has(kind)) return 'read'
    return 'write-external'
  }

  // Unknown tools — including every third-party / external MCP tool — default
  // to deny. We cannot infer what an arbitrary MCP server does, so it must
  // never auto-execute. The caller (an external MCP client or the replay
  // endpoint) can still promote it explicitly via `__promoted`.
  return 'write-external'
}

function isPathOutsideWorkspace(
  path: unknown,
  workspaceRoot?: string,
): boolean {
  if (typeof path !== 'string' || !workspaceRoot) return false
  if (path.includes('..')) return true
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return true
  return false
}

function activePageUrl(ctx: GateContext): string | undefined {
  return ctx.browserContext?.activeTab?.url
}

function isPaymentUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url).hostname.toLowerCase()
    return PAYMENT_HOST_KEYWORDS.some((keyword) => host.includes(keyword))
  } catch {
    return false
  }
}

function escalatesActToSpend(
  args: Record<string, unknown>,
  ctx: GateContext,
): boolean {
  const url = activePageUrl(ctx)
  if (!isPaymentUrl(url)) return false
  const kind = typeof args.kind === 'string' ? args.kind : ''
  return MUTATING_ACT_KINDS.has(kind)
}

function escalatesActToWriteExternal(
  args: Record<string, unknown>,
  _ctx: GateContext,
): boolean {
  const kind = typeof args.kind === 'string' ? args.kind : ''
  if (!MUTATING_ACT_KINDS.has(kind)) return false
  if (kind === 'fill' && args.fields != null) return true
  if (kind === 'fill' || kind === 'type' || kind === 'type_at') return true
  return false
}

/** Derives consequence class from tool name and args only — never from model output. */
export function deriveClass(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
): ConsequenceClass {
  let cls = baseClassForTool(toolName, args)

  if (
    (toolName === 'filesystem_write' || toolName === 'filesystem_edit') &&
    isPathOutsideWorkspace(args.path, ctx.workspaceRoot)
  ) {
    cls = 'system'
  }

  if (toolName === 'filesystem_bash') {
    cls = 'system'
  }

  if (toolName === 'act') {
    const kind = typeof args.kind === 'string' ? args.kind : ''
    if (READ_ACT_KINDS.has(kind)) {
      cls = 'read'
    } else if (escalatesActToSpend(args, ctx)) {
      cls = 'spend'
    } else if (escalatesActToWriteExternal(args, ctx)) {
      cls = 'write-external'
    } else {
      cls = 'write-external'
    }
  }

  return cls
}

export type GateDecision =
  | { action: 'execute' }
  | { action: 'needs-approval' }
  | {
      action: 'dry-run'
      preview: string
      decision: 'dry-run' | 'approval-requested'
    }
  | { action: 'blast-radius-cap'; preview: string }

export function decideGate(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
): GateDecision {
  const cls = deriveClass(toolName, args, ctx)
  if (cls === 'read') return { action: 'execute' }

  const promoted = isPromoted(args)
  const pinActive = isPinActive(ctx, cls)

  const wouldExecute =
    cls === 'write-local'
      ? ctx.surface === 'loop'
        ? promoted || pinActive
        : promoted || pinActive
      : promoted

  if (!wouldExecute) {
    if (cls === 'write-local' && ctx.surface === 'loop') {
      return { action: 'needs-approval' }
    }
    return {
      action: 'dry-run',
      preview: buildPreview(toolName, args, ctx, cls),
      decision: cls === 'write-local' ? 'approval-requested' : 'dry-run',
    }
  }

  if (
    isConsequentialClass(cls) &&
    ctx.runConsequentialCount.count >= getBlastRadiusCap(ctx)
  ) {
    return {
      action: 'blast-radius-cap',
      preview:
        'Blast-radius cap reached for this run. Pin trust in Settings to raise it.',
    }
  }

  return { action: 'execute' }
}

export function recordConsequentialExecution(
  ctx: GateContext,
  cls: ConsequenceClass,
): void {
  if (isConsequentialClass(cls)) {
    ctx.runConsequentialCount.count += 1
  }
}

function buildPreview(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
  cls: ConsequenceClass,
): string {
  if (cls === 'system' || toolName === 'filesystem_bash') {
    if (toolName === 'filesystem_bash') {
      const command = typeof args.command === 'string' ? args.command : ''
      return `Dry-run. Command:\n\n$ ${command}\n\nRe-call with __promoted:true to run.`
    }
    if (toolName === 'evaluate' || toolName === 'run') {
      const code = typeof args.code === 'string' ? args.code : ''
      const label = toolName === 'evaluate' ? 'JS (page)' : 'JS (async)'
      return `Dry-run. ${label} code:\n\n${code}\n\nRe-call with __promoted:true to run.`
    }
    return `Dry-run. Tool ${toolName} would execute. Re-call with __promoted:true to run.`
  }

  if (cls === 'spend') {
    const url = activePageUrl(ctx) ?? '(unknown url)'
    return `Dry-run. Payment-sensitive action at ${url}. Re-call with __promoted:true to execute.`
  }

  if (cls === 'write-local') {
    const path = typeof args.path === 'string' ? args.path : '(unknown path)'
    return `Needs approval: write ${path}. Re-call with __promoted:true to execute.`
  }

  const url = activePageUrl(ctx) ?? '(unknown url)'
  const selector =
    typeof args.ref === 'string'
      ? args.ref
      : typeof args.selector === 'string'
        ? args.selector
        : '(unknown target)'
  const action = typeof args.kind === 'string' ? args.kind : toolName
  return `Dry-run. Would ${action} on ${selector} at ${url}. Re-call with __promoted:true to execute.`
}

export function stripPromotedArg(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const { [PROMOTED_ARG]: _promoted, ...rest } = args
  return rest
}

/**
 * Short, ctx-free, human-readable description of what a tool call would do.
 * Used by the approval UI to preview a paused consequential call (the loop
 * surface no longer returns a dry-run preview as tool output, so the UI
 * renders this from the tool input instead).
 */
export function describeToolCall(
  toolName: string,
  args: Record<string, unknown>,
): string {
  if (toolName === 'filesystem_bash') {
    return `$ ${typeof args.command === 'string' ? args.command : ''}`
  }
  if (toolName === 'filesystem_write' || toolName === 'filesystem_edit') {
    return `${toolName === 'filesystem_write' ? 'write' : 'edit'} ${
      typeof args.path === 'string' ? args.path : '(unknown path)'
    }`
  }
  if (toolName === 'evaluate' || toolName === 'run') {
    const code = typeof args.code === 'string' ? args.code : ''
    const label =
      toolName === 'evaluate' ? 'evaluate (page JS)' : 'run (async JS)'
    return `${label}:\n${code}`
  }
  if (toolName === 'upload') {
    const file = typeof args.file === 'string' ? args.file : ''
    const files = Array.isArray(args.files) ? args.files.join(', ') : ''
    return `upload ${file || files || '(no file)'}`
  }
  if (toolName === 'download') {
    return `download via ${typeof args.ref === 'string' ? args.ref : '(no ref)'}`
  }
  if (toolName === 'act') {
    return `${typeof args.kind === 'string' ? args.kind : 'act'} ${
      typeof args.ref === 'string'
        ? args.ref
        : typeof args.selector === 'string'
          ? args.selector
          : ''
    }`
  }
  if (toolName === 'tabs') {
    return `tabs ${typeof args.action === 'string' ? args.action : 'list'}`
  }
  return toolName
}
