/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { genericAdapter } from './generic'
import { meetAdapter } from './meet'
import { slackAdapter } from './slack'
import { teamsAdapter } from './teams'
import type {
  MatureAdapterMeta,
  MeetingSiteAdapter,
  MeetingSiteId,
} from './types'
import { webexAdapter } from './webex'
import { zoomAdapter } from './zoom'

export const MATURE_ADAPTERS: MeetingSiteAdapter[] = [
  meetAdapter,
  zoomAdapter,
  teamsAdapter,
  slackAdapter,
  webexAdapter,
]

export const ALL_ADAPTERS: MeetingSiteAdapter[] = [
  ...MATURE_ADAPTERS,
  genericAdapter,
]

export function listMatureAdapterMeta(): MatureAdapterMeta[] {
  return MATURE_ADAPTERS.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    defaultHosts: [...a.defaultHosts],
    capabilities: [...a.capabilities],
  }))
}

export function getAdapterById(id: MeetingSiteId): MeetingSiteAdapter | null {
  return ALL_ADAPTERS.find((a) => a.id === id) ?? null
}

export function getAdapterForHost(hostname: string): MeetingSiteAdapter | null {
  const host = hostname.toLowerCase()
  for (const adapter of MATURE_ADAPTERS) {
    if (adapter.matchesHost(host)) return adapter
  }
  return null
}

export function getAdapterForUrl(url: string): MeetingSiteAdapter | null {
  try {
    return getAdapterForHost(new URL(url).hostname)
  } catch {
    return null
  }
}

/**
 * Mature match first; else generic if hostname is on the user allowlist.
 */
export function resolveCaptureAdapter(
  url: string,
  allowedHosts: Set<string> | string[],
): MeetingSiteAdapter | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }

  const allowed =
    allowedHosts instanceof Set
      ? [...allowedHosts]
      : allowedHosts.map((h) => h.toLowerCase())

  const mature = getAdapterForHost(host)
  if (mature) {
    if (isMeetingConsentAllowed(host, allowed)) return mature
    return null
  }

  if (isHostInAllowlist(host, allowed)) return genericAdapter
  return null
}

export function isHostInAllowlist(
  hostname: string,
  allowedHosts: Set<string> | string[],
): boolean {
  const host = hostname.toLowerCase()
  const set =
    allowedHosts instanceof Set
      ? allowedHosts
      : new Set(allowedHosts.map((h) => h.toLowerCase()))
  if (set.has(host)) return true
  // zoom.us consent covers *.zoom.us; webex.com covers *.webex.com
  for (const allowed of set) {
    if (allowed.startsWith('*.') && host.endsWith(allowed.slice(1))) return true
    if (allowed === 'zoom.us' && /^[a-z0-9-]+\.zoom\.us$/i.test(host)) {
      return true
    }
    if (allowed === 'webex.com' && /^[a-z0-9-]+\.webex\.com$/i.test(host)) {
      return true
    }
  }
  return false
}

export function isHostAllowedForAdapter(
  hostname: string,
  adapter: MeetingSiteAdapter,
  allowedHosts: Set<string> | string[],
): boolean {
  const set =
    allowedHosts instanceof Set
      ? allowedHosts
      : new Set(allowedHosts.map((h) => h.toLowerCase()))
  if (adapter.maturity === 'generic') {
    return isHostInAllowlist(hostname, set)
  }
  for (const defaultHost of adapter.defaultHosts) {
    if (isHostInAllowlist(defaultHost, set)) return true
    if (set.has(defaultHost.toLowerCase())) return true
  }
  return isHostInAllowlist(hostname, set)
}

/**
 * True when any consent domain enables this mature adapter (or exact host).
 */
export function isMeetingConsentAllowed(
  hostname: string,
  allowedDomains: string[],
): boolean {
  return isHostInAllowlist(hostname, allowedDomains)
}
