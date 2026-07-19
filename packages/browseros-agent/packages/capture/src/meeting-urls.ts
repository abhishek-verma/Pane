/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Heuristics for in-call meeting URLs vs host landing pages.
 */

import type { DetectedMeetingRoom, MeetingSite } from './types'

const MEETING_HOST_PATTERNS = [
  /^meet\.google\.com$/i,
  /^[a-z0-9-]+\.zoom\.us$/i,
  /^teams\.microsoft\.com$/i,
  /^teams\.live\.com$/i,
  /^app\.slack\.com$/i,
  /^[a-z0-9-]+\.webex\.com$/i,
] as const

/** Meet paths that are not an in-call room. */
const GOOGLE_MEET_PLACEHOLDER_SEGMENTS = new Set([
  '',
  'landing',
  'new',
  'lookup',
  '_meet',
  'about',
])

/** Google Meet room code: abc-defg-hij */
const GOOGLE_MEET_ROOM = /^[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}$/i

export function isMeetingHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return MEETING_HOST_PATTERNS.some((pattern) => pattern.test(host))
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
  if (!detected) return meetingHostname(url)
  return detected.roomKey.split(':').slice(1).join(':') || detected.roomKey
}

/**
 * Canonical room identity for resume: `{site}:{roomKey-suffix}`.
 */
export function detectMeetingRoom(url: string): DetectedMeetingRoom | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname

    if (/^meet\.google\.com$/i.test(host)) {
      const segment = path.replace(/^\//, '').split('/')[0]?.split('?')[0] ?? ''
      if (GOOGLE_MEET_PLACEHOLDER_SEGMENTS.has(segment.toLowerCase())) {
        return null
      }
      if (!GOOGLE_MEET_ROOM.test(segment)) return null
      return { site: 'meet', roomKey: `meet:${segment.toLowerCase()}` }
    }

    if (/^[a-z0-9-]+\.zoom\.us$/i.test(host)) {
      const j = path.match(/^\/(?:j|wc)\/(\d+)/i)
      if (j?.[1]) return { site: 'zoom', roomKey: `zoom:${j[1]}` }
      if (/\/join/i.test(path)) {
        const id = parsed.searchParams.get('confno') ?? path
        return { site: 'zoom', roomKey: `zoom:${id.toLowerCase()}` }
      }
      return null
    }

    if (/^teams\.(microsoft|live)\.com$/i.test(host)) {
      if (
        !(
          path.includes('/meetup-join/') ||
          path.includes('/meeting/') ||
          path.includes('/l/meetup-join/')
        )
      ) {
        return null
      }
      const parts = path.split('/').filter(Boolean)
      const marker = parts.findIndex(
        (p) => p === 'meetup-join' || p === 'meeting' || p === 'l',
      )
      const id =
        marker >= 0
          ? parts.slice(marker).join('/').toLowerCase()
          : path.toLowerCase()
      return { site: 'teams', roomKey: `teams:${id}` }
    }

    if (/^app\.slack\.com$/i.test(host)) {
      const huddle = path.match(/^\/huddle\/([^/]+)\/([^/]+)/i)
      if (!huddle) return null
      return {
        site: 'slack',
        roomKey: `slack:${huddle[1]!.toLowerCase()}/${huddle[2]!.toLowerCase()}`,
      }
    }

    if (/^[a-z0-9-]+\.webex\.com$/i.test(host)) {
      const meet = path.match(/^\/meet\/([^/]+)/i)
      if (meet?.[1]) {
        return {
          site: 'webex',
          roomKey: `webex:${host}/${meet[1]!.toLowerCase()}`,
        }
      }
      const join = path.match(/^\/join\/([^/]+)/i)
      if (join?.[1]) {
        return {
          site: 'webex',
          roomKey: `webex:${host}/${join[1]!.toLowerCase()}`,
        }
      }
      const mk =
        parsed.searchParams.get('MK') ?? parsed.searchParams.get('meetingKey')
      if (mk) {
        return { site: 'webex', roomKey: `webex:${host}/${mk.toLowerCase()}` }
      }
      return null
    }

    return null
  } catch {
    return null
  }
}

export function siteFromRoomKey(roomKey: string): MeetingSite | null {
  const site = roomKey.split(':')[0]
  if (
    site === 'meet' ||
    site === 'zoom' ||
    site === 'teams' ||
    site === 'slack' ||
    site === 'webex'
  ) {
    return site
  }
  return null
}
