import type { BrowserContext } from '../schemas/browser-context'

export type ConsequenceClass =
  | 'read'
  | 'write-local'
  | 'system'
  | 'write-external'
  | 'spend'

export const PROMOTED_ARG = '__promoted' as const

/** @deprecated Unused — pins no longer have a per-turn auto-exec budget. */
export const BLAST_RADIUS_CAP_NEW_USER = 1
/** @deprecated Unused — pins no longer have a per-turn auto-exec budget. */
export const BLAST_RADIUS_CAP_PINNED = Number.POSITIVE_INFINITY

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
  'session_search',
  'tasks_list',
  'skills_load',
  'skills_list',
  'pi_list',
  'pi_read',
  'pi_pulse_get',
  'pi_record_list',
  'pi_open',
  // PI page DSL is the agent's response surface (like streaming chat text),
  // not a side-effect the user must approve. Deletes / site archive stay gated.
  'pi_page_create',
  'pi_page_patch',
  'pi_entity_ensure',
  'trigger_list',
])

const WRITE_LOCAL_TASK_TOOLS = new Set([
  'tasks_add',
  'tasks_done',
  'memory_add',
  'memory_replace',
  'memory_remove',
  'soul_edit',
  'user_edit',
  'skills_install',
  'skills_archive',
  'skills_delete',
  'capture_start',
  'capture_stop',
  'pi_site_upsert',
  'pi_page_delete',
  'pi_site_archive',
  'pi_preserve_temp',
  'pi_home_regions_patch',
  'pi_record_upsert',
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

/** Outcome of a human resolving a `requestApproval` call. Never inferred from silence. */
export type GateApprovalResolution = 'approved' | 'denied' | 'timeout'

export interface GateApprovalRequest {
  toolName: string
  args: Record<string, unknown>
  consequenceClass: ConsequenceClass
  /** ctx-free human-readable description (see describeToolCall). */
  preview: string
}

export type RequestApproval = (
  request: GateApprovalRequest,
) => Promise<GateApprovalResolution>

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
  /**
   * When true, act click/type/fill/press/… require write-external approval.
   * Default false — browser input gestures auto-run (payment hosts still spend).
   */
  requireBrowserInputApproval?: boolean
  /**
   * MCP surface only: when set, a consequential dry-run blocks on this call
   * instead of returning a static "re-call with __promoted:true" preview
   * that an external MCP client has no way to act on. Resolves once a human
   * approves/denies/times out through an external channel (push
   * notification, approvals page). The model never supplies this — only the
   * composition root wires it — so "model can never self-promote" holds.
   */
  requestApproval?: RequestApproval
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

/** @deprecated Pins are uncapped; kept for older callers/tests. */
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
    // 'new' just loads a URL, like `navigate` (unconditionally 'read' below) —
    // opening it in a fresh background tab instead of the current one isn't
    // more consequential. Keep 'close' gated: it can drop the user's work.
    if (action === 'list' || action === 'active' || action === 'new') {
      return 'read'
    }
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
    // Mutating gestures default to read in deriveClass (unless gated);
    // baseClass only needs a conservative fallback for unknown kinds.
    if (MUTATING_ACT_KINDS.has(kind)) return 'read'
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

/** Derives consequence class from tool name and args only — never from model output. */
export function deriveClass(
  toolName: string,
  args: Record<string, unknown>,
  ctx: GateContext,
): ConsequenceClass {
  let cls = baseClassForTool(toolName, args)

  if (toolName === 'filesystem_write' || toolName === 'filesystem_edit') {
    if (isPathOutsideWorkspace(args.path, ctx.workspaceRoot)) {
      cls = 'system'
    } else if (ctx.workspaceRoot && typeof args.path === 'string') {
      // Writing inside the workspace the user explicitly opted the agent
      // into is the common case — auto-allow it. No workspaceRoot configured
      // (or an unresolvable path) keeps the conservative write-local gate.
      cls = 'read'
    }
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
    } else if (MUTATING_ACT_KINDS.has(kind)) {
      // Clicks/types auto-run by default. Opt into gating via Trust settings.
      cls = ctx.requireBrowserInputApproval ? 'write-external' : 'read'
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
  /** @deprecated Blast-radius budgets were removed; never returned. */
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

  // Allow always / Allow for this chat: execute. No per-turn budget.
  if (pinActive) return { action: 'execute' }

  const wouldExecute = promoted

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
    const kind = typeof args.kind === 'string' ? args.kind : 'act'
    const target =
      typeof args.ref === 'string'
        ? args.ref
        : typeof args.selector === 'string'
          ? args.selector
          : typeof args.value === 'string'
            ? args.value.slice(0, 40)
            : typeof args.text === 'string'
              ? args.text.slice(0, 40)
              : ''
    const page =
      typeof args.page === 'number'
        ? ` on page ${args.page}`
        : typeof args.page === 'string'
          ? ` on page ${args.page}`
          : ''
    return `${kind}${target ? ` ${target}` : ''}${page}`.trim()
  }
  if (toolName === 'tabs') {
    const action = typeof args.action === 'string' ? args.action : 'list'
    const url = typeof args.url === 'string' ? ` ${args.url}` : ''
    return `tabs ${action}${url}`
  }
  if (toolName === 'pi_open') {
    const href = typeof args.href === 'string' ? args.href : ''
    return href ? `open ${href}` : 'open PI page'
  }
  if (toolName === 'soul_edit') {
    const content = typeof args.content === 'string' ? args.content : ''
    return `Update SOUL.md (persona, voice, boundaries):\n${previewText(content)}`
  }
  if (toolName === 'user_edit') {
    const content = typeof args.content === 'string' ? args.content : ''
    return `Update USER.md (your profile):\n${previewText(content)}`
  }
  if (toolName === 'memory_add' || toolName === 'memory_replace') {
    const content = typeof args.content === 'string' ? args.content : ''
    return `Remember: ${previewText(content, 200)}`
  }
  if (toolName === 'memory_remove') {
    const match = typeof args.match === 'string' ? args.match : ''
    return `Forget memory matching "${match}"`
  }
  if (toolName === 'skills_install') {
    if (typeof args.body === 'string') {
      const id = typeof args.id === 'string' ? args.id : ''
      const label = id || '(new skill)'
      return `Save new skill "${label}":\n${previewText(args.body, 300)}`
    }
    const source =
      typeof args.url === 'string'
        ? args.url
        : typeof args.path === 'string'
          ? args.path
          : '(source)'
    return `Install skill from ${source}`
  }
  if (toolName === 'skills_archive') {
    const id = typeof args.id === 'string' ? args.id : ''
    return `Archive skill: ${id}`
  }
  if (toolName === 'skills_delete') {
    const id = typeof args.id === 'string' ? args.id : ''
    return `Permanently delete skill: ${id}`
  }
  return toolName
}

function previewText(text: string, maxChars = 400): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  return `${trimmed.slice(0, maxChars)}…`
}
