import {
  deriveClass,
  describeToolCall,
} from '@browseros/shared/trust/consequence-class'
import { ChevronDown } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import {
  conversationTrustStorage,
  PINNABLE_CLASSES,
  type PinnableClass,
  type TrustPinRecord,
  type TrustPinsMap,
  trustPinsStorage,
} from '@/lib/trust/trust-pins-storage'
import { selectedWorkspaceStorage } from '@/lib/workspace/workspace-storage'
import { deriveApprovalCardPhase } from '@/modules/chat/approval-card-phase'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'
import { hasPendingToolApprovals } from '@/modules/chat/collect-tool-approval-responses'
import type { ToolInvocationInfo } from './getMessageSegments'

function extractOutputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (output && typeof output === 'object') {
    if ('text' in output)
      return String((output as { text?: string }).text ?? '')
    if (
      'content' in output &&
      Array.isArray((output as { content: unknown }).content)
    ) {
      return extractOutputText((output as { content: unknown[] }).content)
    }
  }
  return ''
}

export function isDryRunPreview(tool: ToolInvocationInfo): boolean {
  const text = extractOutputText(tool.output)
  return (
    text.startsWith('Dry-run.') ||
    text.startsWith('Needs approval:') ||
    text.includes('Blast-radius cap reached')
  )
}

function parseEditedArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export interface ApprovalCardProps {
  tool: ToolInvocationInfo
  onApprove?: (
    approvalId: string,
    tool: ToolInvocationInfo,
    args: Record<string, unknown>,
  ) => void
  onDeny?: (approvalId: string) => void
  onPromote?: (
    tool: ToolInvocationInfo,
    args: Record<string, unknown>,
  ) => void | Promise<void>
}

const TRUST_SCOPE_LABELS: Record<PinnableClass, string> = {
  'write-local': 'workspace file writes',
  system: 'terminal commands',
  'write-external': 'external browser actions',
  spend: 'payments and purchases',
}

export const ApprovalCard: FC<ApprovalCardProps> = ({
  tool,
  onApprove,
  onDeny,
  onPromote,
}) => {
  const {
    conversationId,
    selectedProvider,
    status,
    messages,
    approvalResumeInFlight,
  } = useChatSessionContext()
  const [workspaceRoot, setWorkspaceRoot] = useState<string | undefined>()
  const [activeTabUrl, setActiveTabUrl] = useState<string | undefined>()
  // `deriveClass` reads `workspaceRoot`/`activeTab.url` — both start
  // `undefined` and that is indistinguishable from "resolved: nothing
  // selected". Track resolution explicitly so Allow-for-this-chat/Always
  // cannot pin the wrong (default) class against a call that would
  // actually have derived a different one once real context loaded.
  const [contextReady, setContextReady] = useState(false)
  const resumeInFlight =
    approvalResumeInFlight || status === 'submitted' || status === 'streaming'

  useEffect(() => {
    let cancelled = false
    Promise.all([
      selectedWorkspaceStorage.getValue(),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]).then(([folder, tabs]) => {
      if (cancelled) return
      setWorkspaceRoot(folder?.path)
      setActiveTabUrl(tabs[0]?.url)
      setContextReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const [editing, setEditing] = useState(false)
  const [argsText, setArgsText] = useState('')
  const [argsError, setArgsError] = useState<string | null>(null)

  const stringifiedInput = JSON.stringify(tool.input ?? {})

  useEffect(() => {
    try {
      setArgsText(JSON.stringify(JSON.parse(stringifiedInput), null, 2))
    } catch {
      setArgsText(stringifiedInput)
    }
    setArgsError(null)
  }, [stringifiedInput])

  const gateCtx = {
    pins: {},
    browserContext: {
      activeTab: {
        id: 0,
        url: activeTabUrl,
        title: '',
      },
      isPrivate: false,
    },
    workspaceRoot,
    runConsequentialCount: { count: 0 },
    isNewUser: false,
    surface: 'loop' as const,
  }
  // Derive from the edited args (if the user is editing) rather than always
  // `tool.input` — editing the path/command can change which consequence
  // class the call belongs to (e.g. moving a write outside the workspace
  // root), and pinning the pre-edit class would be silently wrong.
  const editedArgsForClass = editing ? parseEditedArgs(argsText) : null
  const argsForClass = editedArgsForClass ?? (tool.input as object | null) ?? {}
  const consequenceClass = deriveClass(
    tool.toolName,
    argsForClass as Record<string, unknown>,
    gateCtx,
  )

  const isPinnable =
    !!consequenceClass &&
    (PINNABLE_CLASSES as readonly string[]).includes(consequenceClass)
  const isAcpTarget = selectedProvider?.kind === 'acp'

  const updatePin = async (
    cls: PinnableClass,
    patch: Partial<TrustPinRecord>,
  ) => {
    const next: TrustPinsMap = { ...(await trustPinsStorage.getValue()) }
    const current = next[cls] ?? { pinned: false }
    next[cls] = { ...current, ...patch }
    if (!next[cls]?.pinned) {
      delete next[cls]
    }
    await trustPinsStorage.setValue(next)
  }

  const updateConversationPin = async (
    convoId: string,
    cls: PinnableClass,
    pinned: boolean,
  ) => {
    const next = { ...(await conversationTrustStorage.getValue()) }
    const current = next[convoId] ?? {}
    if (pinned) {
      next[convoId] = { ...current, [cls]: true }
    } else {
      const { [cls]: _, ...rest } = current
      if (Object.keys(rest).length === 0) {
        delete next[convoId]
      } else {
        next[convoId] = rest
      }
    }
    await conversationTrustStorage.setValue(next)
  }

  const preview = extractOutputText(tool.output)
  const phase = deriveApprovalCardPhase({
    toolState: tool.state,
    approved: tool.approval?.approved,
    chatStatus: status,
    approvalResumeInFlight,
    hasPendingSiblingApprovals: hasPendingToolApprovals(messages),
    isDryRun: tool.state === 'output-available' && isDryRunPreview(tool),
  })
  const waitingApproval = phase === 'waiting'
  const dryRun = phase === 'dry-run'
  const waitingSiblings = phase === 'waiting-siblings'
  const resumePending = phase === 'resume-pending'
  const resumeFailed = phase === 'resume-failed'

  const handleAllowAlways = async () => {
    if (!contextReady || !isPinnable || !consequenceClass) return
    await updatePin(consequenceClass as PinnableClass, {
      pinned: true,
      expiresAt: undefined,
    })
    if (waitingApproval) {
      handleApprove()
    } else if (dryRun) {
      handlePromote()
    }
  }

  const handleAllowSession = async () => {
    if (!contextReady || !isPinnable || !consequenceClass || !conversationId)
      return
    await updateConversationPin(
      conversationId,
      consequenceClass as PinnableClass,
      true,
    )
    if (waitingApproval) {
      handleApprove()
    } else if (dryRun) {
      handlePromote()
    }
  }
  // Loop-surface consequential calls pause for approval instead of returning a
  // dry-run preview as output, so render a preview from the tool input here.
  const approvalPreview =
    preview ||
    (waitingApproval
      ? describeToolCall(
          tool.toolName,
          (tool.input ?? {}) as Record<string, unknown>,
        )
      : '')

  if (
    !waitingApproval &&
    !dryRun &&
    !waitingSiblings &&
    !resumePending &&
    !resumeFailed
  ) {
    return null
  }

  // Pane's Approve/Deny only resumes the LLM /chat loop this transcript was
  // recorded against. If the user has since switched to an ACP agent (or
  // restored an older LLM conversation while ACP is the active target),
  // clicking Approve here would POST toolApprovalResponses somewhere that
  // does not understand them — a silent no-op at best. Explain instead of
  // offering a button that cannot work.
  if (isAcpTarget) {
    return (
      <div className="agent-approval mt-2 text-sm">
        {approvalPreview && (
          <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
            {approvalPreview}
          </pre>
        )}
        <p className="text-muted-foreground text-xs">
          Switch to an LLM chat to approve or deny this browser action.
        </p>
      </div>
    )
  }

  const resolveArgs = (): Record<string, unknown> | null => {
    if (!editing) return tool.input
    const parsed = parseEditedArgs(argsText)
    if (!parsed) {
      setArgsError('Args must be valid JSON object')
      return null
    }
    setArgsError(null)
    return parsed
  }

  const handleApprove = () => {
    // Still-pending cards must stay clickable while siblings wait. Only block
    // Retry (already approval-responded) when a resume is actually in flight.
    if (resumeInFlight && tool.state !== 'approval-requested') return
    const id = tool.approval?.id
    if (!id) return
    const args = resolveArgs()
    if (!args) return
    onApprove?.(id, tool, args)
  }

  const handlePromote = () => {
    const args = resolveArgs()
    if (!args) return
    void onPromote?.(tool, args)
  }

  if (waitingSiblings) {
    return (
      <div className="agent-approval mt-2 text-sm">
        <p className="text-muted-foreground text-xs">
          {tool.approval?.approved === false
            ? 'Denied — waiting for other approvals…'
            : 'Waiting for other approvals…'}
        </p>
      </div>
    )
  }

  if (resumePending) {
    return (
      <div className="agent-approval mt-2 text-sm">
        <p className="text-muted-foreground text-xs">
          {tool.approval?.approved === false
            ? 'Submitting denial…'
            : 'Running the approved action…'}
        </p>
      </div>
    )
  }

  if (resumeFailed) {
    return (
      <div className="agent-approval mt-2 text-sm">
        <p className="mb-3 text-muted-foreground text-xs">
          This approval may still need to sync with the server. Retry to sync or
          resume, or Deny to drop it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleApprove}>
            Retry
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (resumeInFlight) return
              const id = tool.approval?.id
              if (id) onDeny?.(id)
            }}
          >
            Deny
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="agent-approval mt-2 text-sm">
      {approvalPreview && (
        <pre className="mb-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
          {approvalPreview}
        </pre>
      )}
      <div className="mb-3 space-y-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setEditing((value) => !value)}
        >
          {editing ? 'Hide args' : 'Edit args'}
        </Button>
        {editing && (
          <>
            <Textarea
              value={argsText}
              onChange={(event) => {
                setArgsText(event.target.value)
                setArgsError(null)
              }}
              className="min-h-28 font-mono text-xs"
              spellCheck={false}
            />
            {argsError && (
              <p className="text-destructive text-xs">{argsError}</p>
            )}
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {waitingApproval && tool.approval?.id && (
          <>
            {isPinnable && consequenceClass ? (
              <ButtonGroup>
                <Button size="sm" onClick={handleApprove}>
                  Approve
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="border-primary-foreground/20 border-l px-1.5"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!contextReady}
                      onClick={handleAllowSession}
                    >
                      Allow for this chat:{' '}
                      {TRUST_SCOPE_LABELS[consequenceClass as PinnableClass]}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!contextReady}
                      onClick={handleAllowAlways}
                    >
                      Allow always:{' '}
                      {TRUST_SCOPE_LABELS[consequenceClass as PinnableClass]}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            ) : (
              <Button size="sm" onClick={handleApprove}>
                Approve
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const id = tool.approval?.id
                if (id) onDeny?.(id)
              }}
            >
              Deny
            </Button>
          </>
        )}
        {dryRun && (
          <>
            {isPinnable && consequenceClass ? (
              <ButtonGroup>
                <Button size="sm" onClick={handlePromote}>
                  Promote
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      className="border-primary-foreground/20 border-l px-1.5"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!contextReady}
                      onClick={handleAllowSession}
                    >
                      Allow for this chat:{' '}
                      {TRUST_SCOPE_LABELS[consequenceClass as PinnableClass]}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!contextReady}
                      onClick={handleAllowAlways}
                    >
                      Allow always:{' '}
                      {TRUST_SCOPE_LABELS[consequenceClass as PinnableClass]}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            ) : (
              <Button size="sm" onClick={handlePromote}>
                Promote
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const id = tool.approval?.id
                if (id) onDeny?.(id)
              }}
            >
              Deny
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
