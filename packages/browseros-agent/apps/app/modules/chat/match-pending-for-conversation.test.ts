/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import {
  matchPendingForConversation,
  type PendingApprovalRow,
} from './match-pending-for-conversation'

describe('matchPendingForConversation', () => {
  const rows: PendingApprovalRow[] = [
    {
      id: 'a1',
      conversationId: 'c1',
      toolName: 'run',
      consequenceClass: 'system',
      preview: 'Needs approval: run (async JS):\ncode',
      approveToken: 'ap1',
      denyToken: 'dn1',
      status: 'pending',
    },
    {
      id: 'a2',
      conversationId: 'c2',
      toolName: 'act',
      consequenceClass: 'write-external',
      preview: 'click',
      approveToken: 'ap2',
      denyToken: 'dn2',
      status: 'pending',
    },
    {
      id: 'a3',
      conversationId: 'c1',
      toolName: 'run',
      consequenceClass: 'system',
      preview: 'done',
      approveToken: 'ap3',
      denyToken: 'dn3',
      status: 'approved',
    },
  ]

  test('matches pending rows for the open conversation only', () => {
    const matched = matchPendingForConversation(rows, 'c1')
    expect(matched).toHaveLength(1)
    expect(matched[0]?.id).toBe('a1')
    expect(matched[0]?.toolName).toBe('run')
  })

  test('returns empty when conversation has no pending', () => {
    expect(matchPendingForConversation(rows, 'missing')).toEqual([])
  })
})
