/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pure matcher for channel pending approvals → open conversation.
 */

export type PendingApprovalRow = {
  id: string
  conversationId?: string | null
  toolName: string
  preview: string
  approveToken: string
  denyToken: string
  status: string
}

export type MatchedPendingApproval = {
  id: string
  toolName: string
  preview: string
  approveToken: string
  denyToken: string
}

export function matchPendingForConversation(
  approvals: PendingApprovalRow[],
  conversationId: string,
): MatchedPendingApproval[] {
  return approvals
    .filter(
      (a) => a.status === 'pending' && a.conversationId === conversationId,
    )
    .map((a) => ({
      id: a.id,
      toolName: a.toolName,
      preview: a.preview,
      approveToken: a.approveToken,
      denyToken: a.denyToken,
    }))
}
