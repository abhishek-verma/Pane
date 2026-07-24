/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * fetch wrapper that attaches the Chrome profile key to every agent-server
 * request so the sidecar can isolate chat/context/agents per profile.
 */

import { BROWSEROS_PROFILE_ID_HEADER } from '@browseros/shared/constants/headers'
import { getBrowserProfileKey } from './profile-key'

/** Builds headers that identify the active Chrome browser profile. */
export async function getAgentProfileHeaders(): Promise<
  Record<string, string>
> {
  const profileKey = await getBrowserProfileKey()
  return { [BROWSEROS_PROFILE_ID_HEADER]: profileKey }
}

/**
 * Like fetch, but merges `X-BrowserOS-Profile-Id` into the request headers.
 * Use for all calls to the local agent server that touch user data.
 */
export async function agentFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const profileHeaders = await getAgentProfileHeaders()
  const headers = new Headers(init?.headers)
  for (const [key, value] of Object.entries(profileHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  }
  return fetch(input, { ...init, headers })
}
