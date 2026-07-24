/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'

const PROFILE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

mock.module('./profile-key', () => ({
  getBrowserProfileKey: async () => PROFILE,
}))

describe('agentFetch', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    fetchMock = mock(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('attaches the profile header', async () => {
    const { agentFetch } = await import('./agent-fetch')
    await agentFetch('http://127.0.0.1:9100/chat/history')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get(BROWSEROS_PROFILE_ID_HEADER)).toBe(PROFILE)
  })

  it('does not overwrite an explicit profile header', async () => {
    const { agentFetch } = await import('./agent-fetch')
    const custom = '99999999-9999-4999-8999-999999999999'
    await agentFetch('http://127.0.0.1:9100/chat/history', {
      headers: { [BROWSEROS_PROFILE_ID_HEADER]: custom },
    })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get(BROWSEROS_PROFILE_ID_HEADER)).toBe(custom)
  })
})
