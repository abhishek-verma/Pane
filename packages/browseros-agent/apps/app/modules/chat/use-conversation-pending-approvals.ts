/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Channel (unattended) pending approvals for the open conversation.
 * Background runs never emit AI SDK approval-requested parts, so chat must
 * poll /scheduler/approvals or the user only sees Home Today cards.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import {
  type ResolveChannelApprovalResult,
  resolveChannelApproval,
} from '@/lib/trust/resolve-channel-approval'
import {
  PINNABLE_CLASSES,
  type PinnableClass,
} from '@/lib/trust/trust-pins-storage'
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
      resolution: 'approve' | 'deny' | 'allowForChat' | 'allowAlways',
    ) => {
      setResolvingId(approval.id)
      setNote(null)
      let result: ResolveChannelApprovalResult
      if (resolution === 'allowForChat' || resolution === 'allowAlways') {
        if (
          !PINNABLE_CLASSES.includes(approval.consequenceClass as PinnableClass)
        ) {
          setResolvingId(null)
          return {
            ok: false,
            resumed: false,
            detail: 'This action cannot be granted persistent trust.',
          }
        }
        result = await resolveChannelApproval(
          approval.approveToken,
          resolution === 'allowAlways' ? 'always' : 'chat',
        )
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
    [refresh, queryClient],
  )

  return {
    approvals,
    resolvingId,
    note,
    resolve,
    refresh,
  }
}
