/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Thin wrappers over the meeting site adapter registry.
 * Prefer `@browseros/capture/adapters` for new code.
 */

import {
  getAdapterForHost,
  getAdapterForUrl,
  MATURE_ADAPTERS,
  resolveCaptureAdapter,
} from './adapters/registry'
import type { DetectedMeetingRoom, MeetingSite } from './types'

export function isMeetingHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return MATURE_ADAPTERS.some((adapter) => adapter.matchesHost(host))
  } catch {
    return false
  }
}

/** True when the URL is an active meeting room, not a landing/join page. */
export function isMeetingRoomUrl(url: string): boolean {
  return detectMeetingRoom(url) !== null
}

/** @deprecated Use isMeetingRoomUrl for capture triggers; kept for host-only checks. */
export function isMeetingUrl(url: string): boolean {
  return isMeetingRoomUrl(url)
}

export function meetingHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function meetingRoomLabel(url: string): string | null {
  const detected = detectMeetingRoom(url)
  if (!detected) {
    // Generic / allowlisted rooms
    try {
      const parsed = new URL(url)
      return parsed.pathname.replace(/^\//, '') || parsed.hostname
    } catch {
      return meetingHostname(url)
    }
  }
  return detected.roomKey.split(':').slice(1).join(':') || detected.roomKey
}

/**
 * Canonical room identity for resume: `{site}:{roomKey-suffix}`.
 * Mature adapters only — use `detectMeetingRoomForCapture` when consent
 * allowlist may include generic hosts.
 */
export function detectMeetingRoom(url: string): DetectedMeetingRoom | null {
  const adapter = getAdapterForUrl(url)
  if (!adapter) return null
  const room = adapter.detectRoom(url)
  if (!room) return null
  return { site: adapter.id, roomKey: room.roomKey }
}

/**
 * Resolve room via mature adapter or generic when host is allowlisted.
 */
export function detectMeetingRoomForCapture(
  url: string,
  allowedHosts: Set<string> | string[],
): DetectedMeetingRoom | null {
  const adapter = resolveCaptureAdapter(url, allowedHosts)
  if (!adapter) return null
  const room = adapter.detectRoom(url)
  if (!room) return null
  return { site: adapter.id, roomKey: room.roomKey }
}

export function siteFromRoomKey(roomKey: string): MeetingSite | null {
  const site = roomKey.split(':')[0]
  if (
    site === 'meet' ||
    site === 'zoom' ||
    site === 'teams' ||
    site === 'slack' ||
    site === 'webex' ||
    site === 'generic'
  ) {
    return site
  }
  return null
}

/** @deprecated Prefer getAdapterForHost from adapters */
export function adapterHostLookup(hostname: string) {
  return getAdapterForHost(hostname)
}
