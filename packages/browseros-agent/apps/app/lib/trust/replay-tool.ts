import type { ChatRequestBrowserContext } from '@/lib/messaging/server/buildChatRequestBody'

export interface ReplayToolParams {
  toolName: string
  args: Record<string, unknown>
  conversationId?: string
  toolCallId?: string
  userWorkingDir?: string
  workspaceId?: string
  bucketId?: string
  trustPins?: Record<string, { pinned: boolean; expiresAt?: number }>
  browserContext?: ChatRequestBrowserContext
}

export interface ReplayToolResponse {
  toolName: string
  consequenceClass: string
  decision: 'executed' | 'promoted' | 'dry-run' | 'denied'
  output: unknown
  isError: boolean
}

export async function replayToolOnServer(
  baseUrl: string,
  params: ReplayToolParams,
  signal?: AbortSignal,
): Promise<ReplayToolResponse> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/trust/replay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Replay failed (${res.status})`)
  }

  return res.json() as Promise<ReplayToolResponse>
}
