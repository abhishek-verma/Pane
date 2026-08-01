/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import { groupConversations } from './utils'

describe('groupConversations', () => {
  test('puts background agents in their own section', () => {
    const now = Date.now()
    const grouped = groupConversations([
      {
        id: '1',
        lastMessagedAt: now,
        lastUserMessage: 'hello',
      },
      {
        id: '2',
        lastMessagedAt: now - 1000,
        lastUserMessage: 'harvest',
        isBackground: true,
        backgroundSource: 'pi-harvest',
      },
    ])
    expect(grouped.background.map((c) => c.id)).toEqual(['2'])
    expect(grouped.today.map((c) => c.id)).toEqual(['1'])
  })
})
