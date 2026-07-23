import type { UIMessage } from 'ai'

type ToolPartLike = {
  type?: string
  toolCallId?: string
  state?: string
}

function isToolPart(part: unknown): part is ToolPartLike {
  if (!part || typeof part !== 'object') return false
  const type = (part as ToolPartLike).type
  return (
    typeof type === 'string' &&
    (type === 'dynamic-tool' || type.startsWith('tool-'))
  )
}

const TERMINAL_TOOL_STATES = new Set([
  'output-available',
  'output-denied',
  'output-error',
  'denied',
])

/** Server terminals that mean the tool actually ran (or failed while running). */
const STOP_RACE_UPGRADEABLE = new Set(['output-available', 'output-error'])

const IN_FLIGHT_TOOL_STATES = new Set([
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'partial-call',
  'call',
])

/** True when any assistant tool part is still stuck in approval-responded. */
export function hasApprovalRespondedParts(messages: UIMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts ?? []) {
      if (!isToolPart(part)) continue
      if (part.state === 'approval-responded') return true
    }
  }
  return false
}

/**
 * Overlay terminal tool-part states from a server transcript onto the client's
 * live messages. Used after an approval resume when the SSE merge left local
 * parts stuck at `approval-responded` even though the server already executed
 * (or denied) them.
 *
 * Upgrades:
 * - client `approval-responded` / `approval-requested` → any server terminal
 * - client `output-denied` → server `output-available` / `output-error` only
 *   (Stop raced a resume that already executed; never overwrite a true denial
 *   when the server is also `output-denied`)
 *
 * Never overwrites other client terminals with an older server state.
 */
export function reconcileClientToolStatesFromServer(
  clientMessages: UIMessage[],
  serverMessages: UIMessage[],
): UIMessage[] {
  const serverByCallId = new Map<string, Record<string, unknown>>()
  for (const message of serverMessages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts ?? []) {
      if (!isToolPart(part) || !part.toolCallId) continue
      if (!part.state || !TERMINAL_TOOL_STATES.has(part.state)) continue
      serverByCallId.set(part.toolCallId, part as Record<string, unknown>)
    }
  }
  if (serverByCallId.size === 0) return clientMessages

  let changed = false
  const next = clientMessages.map((message) => {
    if (message.role !== 'assistant') return message
    let partsChanged = false
    const parts = (message.parts ?? []).map((part) => {
      if (!isToolPart(part) || !part.toolCallId) return part
      const serverPart = serverByCallId.get(part.toolCallId)
      if (!serverPart) return part

      const canUpgradeStuck =
        part.state === 'approval-responded' ||
        part.state === 'approval-requested'
      const serverState = String(serverPart.state ?? '')
      const canUpgradeStopRace =
        part.state === 'output-denied' && STOP_RACE_UPGRADEABLE.has(serverState)
      if (!canUpgradeStuck && !canUpgradeStopRace) return part

      partsChanged = true
      changed = true
      return { ...part, ...serverPart } as typeof part
    })
    if (!partsChanged) return message
    return { ...message, parts }
  })
  return changed ? next : clientMessages
}

function hasTextPart(message: UIMessage): boolean {
  return (message.parts ?? []).some(
    (part) =>
      part?.type === 'text' &&
      typeof (part as { text?: string }).text === 'string' &&
      (part as { text: string }).text.trim().length > 0,
  )
}

function hasInFlightToolParts(message: UIMessage): boolean {
  for (const part of message.parts ?? []) {
    if (!isToolPart(part) || !part.state) continue
    if (IN_FLIGHT_TOOL_STATES.has(part.state)) return true
  }
  return false
}

function countToolParts(message: UIMessage): number {
  let count = 0
  for (const part of message.parts ?? []) {
    if (isToolPart(part)) count += 1
  }
  return count
}

function countTerminalToolParts(message: UIMessage): number {
  let count = 0
  for (const part of message.parts ?? []) {
    if (!isToolPart(part) || !part.state) continue
    if (TERMINAL_TOOL_STATES.has(part.state)) count += 1
  }
  return count
}

/**
 * A server assistant turn is "complete enough" to hydrate when it has settled
 * tool work (no in-flight tool states) and either produced text or finished
 * at least one tool.
 *
 * Note: onStepFinish checkpoints can look "complete" after a tool step and
 * before the next model step. Callers that may run while a turn is still
 * active (stuck-stream watchdog) should also require `hasAssistantText`.
 */
export function isCompleteAssistantTurn(
  message: UIMessage | undefined,
): boolean {
  if (message?.role !== 'assistant') return false
  const parts = message.parts ?? []
  if (parts.length === 0) return false
  if (hasInFlightToolParts(message)) return false
  return hasTextPart(message) || countTerminalToolParts(message) > 0
}

/** True when the assistant message includes non-empty text. */
export function hasAssistantText(message: UIMessage | undefined): boolean {
  return !!message && hasTextPart(message)
}

function findLastAssistant(messages: UIMessage[]): UIMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'assistant') return messages[i]
  }
  return undefined
}

function findMessageIndexById(messages: UIMessage[], id: string): number {
  return messages.findIndex((message) => message.id === id)
}

/**
 * True when the client still has unanswered approval cards the user may be
 * editing. Hydrate must not replace those with a server snapshot that drops
 * local arg edits.
 */
function hasPendingApprovalRequested(messages: UIMessage[]): boolean {
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts ?? []) {
      if (!isToolPart(part)) continue
      if (part.state === 'approval-requested') return true
    }
  }
  return false
}

function serverAssistantIsAhead(
  client: UIMessage | undefined,
  server: UIMessage,
): boolean {
  if (!client) return true
  if (client.id !== server.id) return true

  const clientParts = client.parts ?? []
  const serverParts = server.parts ?? []
  if (serverParts.length > clientParts.length) return true
  if (hasTextPart(server) && !hasTextPart(client)) return true
  if (countTerminalToolParts(server) > countTerminalToolParts(client)) {
    return true
  }
  // Same part count but client still in-flight while server settled.
  if (hasInFlightToolParts(client) && !hasInFlightToolParts(server)) {
    return true
  }
  // Rare: equal length but server gained a trailing text/tool the client
  // never merged (ids collide after a partial SSE apply).
  if (
    serverParts.length === clientParts.length &&
    countToolParts(server) >= countToolParts(client) &&
    hasTextPart(server) &&
    hasTextPart(client)
  ) {
    const clientText = clientParts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text?: string }).text ?? '')
      .join('')
    const serverText = serverParts
      .filter((part) => part.type === 'text')
      .map((part) => (part as { text?: string }).text ?? '')
      .join('')
    if (serverText.length > clientText.length) return true
  }
  return false
}

export type HydrateClientMessagesResult = {
  messages: UIMessage[]
  /** True when the client was missing a completed server assistant turn. */
  hydratedAssistantTurn: boolean
}

/**
 * Bring the client transcript in line with a completed server turn.
 *
 * 1. Always run tool-state reconcile (approval-responded / stop-race upgrades).
 * 2. If the server's last assistant message is complete and ahead of the
 *    client (missing message, missing trailing text after tools, fewer
 *    terminal tool outputs), replace/append that assistant message.
 *
 * Does not clobber in-progress approval-requested cards the user may still
 * be editing — those only receive tool-state overlays from step 1.
 */
export function hydrateClientMessagesFromServer(
  clientMessages: UIMessage[],
  serverMessages: UIMessage[],
): HydrateClientMessagesResult {
  // Check the pre-reconcile client: reconcile may upgrade a card to
  // output-available, but a full message replace would still drop any
  // local arg edits the user made while it was approval-requested.
  const hadPendingApprovals = hasPendingApprovalRequested(clientMessages)

  const reconciled = reconcileClientToolStatesFromServer(
    clientMessages,
    serverMessages,
  )

  const serverAssistant = findLastAssistant(serverMessages)
  if (!isCompleteAssistantTurn(serverAssistant) || !serverAssistant) {
    return {
      messages: reconciled,
      hydratedAssistantTurn: false,
    }
  }

  // Pending Approve/Deny cards: only tool-state reconcile. Replacing the
  // whole assistant message would drop local arg edits mid-review.
  if (hadPendingApprovals) {
    return {
      messages: reconciled,
      hydratedAssistantTurn: false,
    }
  }

  const clientAssistant = findLastAssistant(reconciled)
  if (!serverAssistantIsAhead(clientAssistant, serverAssistant)) {
    return {
      messages: reconciled,
      hydratedAssistantTurn: false,
    }
  }

  const existingIdx = findMessageIndexById(reconciled, serverAssistant.id)
  if (existingIdx >= 0) {
    const next = reconciled.slice()
    next[existingIdx] = serverAssistant
    return { messages: next, hydratedAssistantTurn: true }
  }

  // Client never got the assistant message (SSE finish dropped). Insert it
  // after the matching preceding user message when possible; otherwise append.
  const serverIdx = findMessageIndexById(serverMessages, serverAssistant.id)
  const serverPrev = serverIdx > 0 ? serverMessages[serverIdx - 1] : undefined
  if (serverPrev?.role === 'user') {
    const clientPrevIdx = findMessageIndexById(reconciled, serverPrev.id)
    if (clientPrevIdx >= 0) {
      const next = [
        ...reconciled.slice(0, clientPrevIdx + 1),
        serverAssistant,
        ...reconciled
          .slice(clientPrevIdx + 1)
          .filter((message) => message.id !== serverAssistant.id),
      ]
      return { messages: next, hydratedAssistantTurn: true }
    }
  }

  return {
    messages: [...reconciled, serverAssistant],
    hydratedAssistantTurn: true,
  }
}
