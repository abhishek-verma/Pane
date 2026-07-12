/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Heuristics for in-call meeting URLs vs host landing pages (Meet /landing, /new).
 */

const MEETING_HOST_PATTERNS = [
  /^meet\.google\.com$/i,
  /^[a-z0-9-]+\.zoom\.us$/i,
  /^teams\.microsoft\.com$/i,
  /^teams\.live\.com$/i,
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
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const path = parsed.pathname

    if (/^meet\.google\.com$/i.test(host)) {
      const segment = path.replace(/^\//, '').split('/')[0]?.split('?')[0] ?? ''
      if (GOOGLE_MEET_PLACEHOLDER_SEGMENTS.has(segment.toLowerCase())) {
        return false
      }
      return GOOGLE_MEET_ROOM.test(segment)
    }

    if (/^[a-z0-9-]+\.zoom\.us$/i.test(host)) {
      return /^\/(j|wc)\/\d+/i.test(path) || /\/join/i.test(path)
    }

    if (/^teams\.(microsoft|live)\.com$/i.test(host)) {
      return (
        path.includes('/meetup-join/') ||
        path.includes('/meeting/') ||
        path.includes('/l/meetup-join/')
      )
    }

    return false
  } catch {
    return false
  }
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
  try {
    const parsed = new URL(url)
    if (/^meet\.google\.com$/i.test(parsed.hostname)) {
      const segment = parsed.pathname.replace(/^\//, '').split('/')[0] ?? ''
      if (GOOGLE_MEET_ROOM.test(segment)) return segment
    }
    return parsed.hostname
  } catch {
    return null
  }
}
