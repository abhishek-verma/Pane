/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Channel (unattended) pending approvals for the open conversation.
 * Background runs never emit AI SDK approval-requested parts, so chat must
 * poll /scheduler/approvals or the user only sees Home Today cards.
 */

import type { ConsequenceClass } from '@browseros/shared/trust/consequence-class'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { conversationTrustStorage } from '@/lib/trust/trust-pins-storage'
import { matchPendingForConversation } from '@/modules/chat/match-pending-for-conversation'
import { HOME_QUERY_KEY } from '@/screens/newtab/home/home-data'

export type ConversationPendingApproval = {
  id: string
  toolName: string
  consequenceClass: string
  preview: string
  approveToken: string
  denyToken: string
}

export type ResolveChannelApprovalResult = {
  ok: boolean
  resumed: boolean
  detail: string
}

async function fetchPendingForConversation(
  conversationId: string,
): Promise<ConversationPendingApproval[]> {
  const base = await getAgentServerUrl()
  const res = await agentFetch(`${base}/scheduler/approvals`)
  if (!res.ok) return []
  const body = (await res.json()) as {
    approvals?: Array<{
      id: string
      conversationId?: string | null
      toolName: string
      consequenceClass: string
      preview: string
      approveToken: string
      denyToken: string
      status: string
    }>
  }
  return matchPendingForConversation(body.approvals ?? [], conversationId)
}

export async function resolveChannelApproval(
  token: string,
  options?: { pin?: boolean },
): Promise<ResolveChannelApprovalResult> {
  try {
    const base = await getAgentServerUrl()
    const res = await agentFetch(`${base}/scheduler/approvals/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, pin: options?.pin }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      return {
        ok: false,
        resumed: false,
        detail: body?.error ?? `Resolve failed (${res.status})`,
      }
    }
    const body = (await res.json()) as {
      resolution?: string
      resumed?: boolean
      reason?: string
    }
    const resumed = Boolean(body.resumed)
    if (body.resolution === 'approved') {
      return {
        ok: true,
        resumed,
        detail: resumed
          ? 'Approved — the agent can continue this step'
          : 'Approved, but the agent is no longer waiting (timed out or restarted). This step will not run.',
      }
    }
    if (body.resolution === 'denied') {
      return {
        ok: true,
        resumed,
        detail: resumed
          ? 'Denied — the agent will skip this step'
          : 'Denied. The agent was no longer waiting on this approval.',
      }
    }
    return {
      ok: true,
      resumed,
      detail: body.reason ?? 'Resolved',
    }
  } catch {
    return {
      ok: false,
      resumed: false,
      detail: 'Could not reach the agent server',
    }
  }
}

export function useConversationPendingApprovals(
  conversationId: string | null | undefined,
  opts?: { enabled?: boolean; pollMs?: number },
) {
  const queryClient = useQueryClient()
  const enabled = opts?.enabled !== false && Boolean(conversationId)
  const pollMs = opts?.pollMs ?? 2000
  const [approvals, setApprovals] = useState<ConversationPendingApproval[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const hadApprovalsRef = useRef(false)

  const refresh = useCallback(async () => {
    if (!conversationId || !enabled) {
      setApprovals([])
      return
    }
    try {
      const next = await fetchPendingForConversation(conversationId)
      setApprovals(next)
    } catch {
      /* best-effort */
    }
  }, [conversationId, enabled])

  useEffect(() => {
    if (!enabled || !conversationId) {
      setApprovals([])
      hadApprovalsRef.current = false
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const next = await fetchPendingForConversation(conversationId)
        if (cancelled) return
        if (hadApprovalsRef.current && next.length === 0) {
          void queryClient.invalidateQueries({
            queryKey: [...HOME_QUERY_KEY],
          })
        }
        hadApprovalsRef.current = next.length > 0
        setApprovals(next)
      } catch {
        /* best-effort */
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), pollMs)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [conversationId, enabled, pollMs, queryClient])

  const resolve = useCallback(
    async (
      approval: ConversationPendingApproval,
      resolution: 'approve' | 'deny' | 'allowForChat',
    ) => {
      setResolvingId(approval.id)
      setNote(null)
      let result: ResolveChannelApprovalResult
      if (resolution === 'allowForChat') {
        result = await resolveChannelApproval(approval.approveToken, {
          pin: true,
        })
        // Persist client-side so it survives server restart
        if (conversationId) {
          const current = await conversationTrustStorage.getValue()
          const cls = approval.consequenceClass as ConsequenceClass
          await conversationTrustStorage.setValue({
            ...current,
            [conversationId]: {
              ...(current[conversationId] ?? {}),
              [cls]: true,
            },
          })
        }
      } else {
        const token =
          resolution === 'approve' ? approval.approveToken : approval.denyToken
        result = await resolveChannelApproval(token)
      }
      setNote(result.detail)
      setResolvingId(null)
      await refresh()
      void queryClient.invalidateQueries({ queryKey: [...HOME_QUERY_KEY] })
      return result
    },
    [conversationId, refresh, queryClient],
  )

  return {
    approvals,
    resolvingId,
    note,
    resolve,
    refresh,
  }
}
