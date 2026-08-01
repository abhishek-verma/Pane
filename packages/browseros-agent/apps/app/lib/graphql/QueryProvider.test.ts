/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, test } from 'bun:test'
import { type Query, QueryClient } from '@tanstack/react-query'
import { shouldDehydrateQueryForLoContainment } from './QueryProvider'

function fakeQuery(queryKey: unknown[]): Query {
  const client = new QueryClient()
  return client
    .getQueryCache()
    .build(client, { queryKey, queryFn: async () => null })
}

describe('shouldDehydrateQueryForLoContainment', () => {
  test('excludes pi and chat history keys', () => {
    expect(
      shouldDehydrateQueryForLoContainment(
        fakeQuery(['pi', 'page', 'site', 'page']),
      ),
    ).toBe(false)
    expect(
      shouldDehydrateQueryForLoContainment(
        fakeQuery(['sidepanel-chat-history', 'http://localhost']),
      ),
    ).toBe(false)
    expect(
      shouldDehydrateQueryForLoContainment(
        fakeQuery(['harness-agent-history', 'x']),
      ),
    ).toBe(false)
  })

  test('allows small non-pi keys', () => {
    expect(shouldDehydrateQueryForLoContainment(fakeQuery(['providers']))).toBe(
      true,
    )
  })
})
