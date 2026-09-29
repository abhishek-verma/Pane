import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { persistApprovedTrust } from './persist-approved-trust'

export type ResolveChannelApprovalResult = {
  ok: boolean
  detail: string
  resumed: boolean
  resolution?: string
}

export async function resolveChannelApproval(
  token: string,
  trustScope?: 'chat' | 'always',
): Promise<ResolveChannelApprovalResult> {
  let resolution: string | undefined
  let ok = false
  let detail = 'Could not reach the agent server'
  let resumed = false
  try {
    const base = await getAgentServerUrl()
    const res = await agentFetch(`${base}/scheduler/approvals/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        pin: Boolean(trustScope),
      }),
    })
    if (res.ok) {
      ok = true
      const body = (await res.json().catch(() => null)) as {
        resolution?: string
        resumed?: boolean
        reason?: string
        approval?: {
          conversationId?: string | null
          consequenceClass: string
        }
      } | null
      resumed = Boolean(body?.resumed)
      resolution = body?.resolution
      if (body?.resolution === 'approved') {
        detail = resumed
          ? 'Approved — the agent can continue this step'
          : 'Approved, but the agent is no longer waiting (timed out or restarted). This step will not run.'
      } else if (body?.resolution === 'denied') {
        detail = resumed
          ? 'Denied — the agent will skip this step'
          : 'Denied. The agent was no longer waiting on this approval.'
      } else {
        detail = 'This request expired. The step was not approved.'
      }
      if (
        trustScope &&
        body?.approval &&
        resumed &&
        body.resolution === 'approved'
      ) {
        try {
          const saved = await persistApprovedTrust({
            result: { ok, resumed, resolution: body.resolution },
            scope: trustScope,
            conversationId: body.approval.conversationId,
            consequenceClass: body.approval.consequenceClass,
          })
          detail = saved
            ? trustScope === 'always'
              ? 'Approved — this action category is now allowed for future runs. Manage permissions in Settings.'
              : 'Approved — this action category is allowed for this chat.'
            : 'Approved, but this action category could not be remembered.'
        } catch {
          detail =
            'Approved for this chat, but the trust preference could not be saved. Please retry from Settings.'
        }
      }
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      detail = body?.error ?? `Resolve failed (${res.status})`
    }
  } catch {
    /* network blip */
  }
  return { ok, detail, resumed, resolution }
}
