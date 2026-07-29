/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Notify the agent server when the user opens a host that may trigger
 * Personalised Internet harvest (kind C). Server no-ops unless a site has
 * harvestEnabled + matching host filter.
 */

import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

const DEBOUNCE_MS = 30_000
const lastByHost = new Map<string, number>()

function hostFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function notifyPiHostOpened(url: string): void {
  const host = hostFromUrl(url)
  if (!host) return
  const now = Date.now()
  const last = lastByHost.get(host) ?? 0
  if (now - last < DEBOUNCE_MS) return
  lastByHost.set(host, now)

  void (async () => {
    try {
      const base = (await getAgentServerUrl()).replace(/\/$/, '')
      await agentFetch(`${base}/pi/hooks/host-opened`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      })
      // Nudge drain so pi-harvest runs don't wait a full alarm period (S8).
      const { nudgeDrainServerRuns } = await import(
        '@/lib/schedules/nudgeDrainServerRuns'
      )
      await nudgeDrainServerRuns()
    } catch {
      // Server may be down during early boot; harvest is best-effort.
    }
  })()
}
