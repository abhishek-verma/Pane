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
