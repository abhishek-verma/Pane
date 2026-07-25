/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * On onboarding complete: seed SOUL.md persona + USER.md from ICP/profile.
 * Idempotent — skips persona apply if already configured (e.g. Soul step).
 * Never overwrites an already-applied SOUL.md.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { personaIdForIcp } from '@/lib/onboarding/icp'
import {
  onboardingIcpStorage,
  onboardingProfileStorage,
} from '@/lib/onboarding/onboardingStorage'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'

function base(url: string) {
  return url.replace(/\/$/, '')
}

export async function seedMemoryFromOnboarding(
  serverBaseUrl: string,
): Promise<void> {
  const root = base(serverBaseUrl)
  const [icp, profile] = await Promise.all([
    onboardingIcpStorage.getValue(),
    onboardingProfileStorage.getValue(),
  ])

  let personaAlreadySet = false
  try {
    const personasRes = await agentFetch(`${root}/memory/personas`)
    if (personasRes.ok) {
      const body = (await personasRes.json()) as {
        map: { pinned: string | null; bucketPersonas: Record<string, string> }
      }
      if (
        body.map.pinned ||
        Object.keys(body.map.bucketPersonas ?? {}).length > 0
      ) {
        personaAlreadySet = true
      }
    }
  } catch {
    // Server may be down — still try USER.md below.
  }

  if (!personaAlreadySet) {
    const personaId = personaIdForIcp(icp)
    try {
      await agentFetch(`${root}/memory/personas/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId, bucketId: 'default' }),
      })
    } catch {
      // best-effort; USER.md write still runs
    }
  }

  const userLines = [
    '# User',
    '',
    profile?.name ? `- Name: ${profile.name}` : '- Name: (unknown)',
    profile?.role ? `- Role: ${profile.role}` : null,
    profile?.company ? `- Company: ${profile.company}` : null,
    icp ? `- Primary use: ${icp}` : null,
    profile?.description ? `- Notes: ${profile.description}` : null,
  ].filter((line): line is string => line != null)

  try {
    await agentFetch(`${root}/memory/files/user`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `${userLines.join('\n')}\n` }),
    })
  } catch {
    // best-effort
  }
}

/** Hook-friendly wrapper that resolves the agent server URL. */
export function useSeedMemoryFromOnboarding() {
  const { baseUrl } = useAgentServerUrl()
  return async () => {
    if (!baseUrl) return
    await seedMemoryFromOnboarding(baseUrl as string)
  }
}
