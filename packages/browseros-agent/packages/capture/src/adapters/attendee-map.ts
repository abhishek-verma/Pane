/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Resolve short labels (initials / partial) to full participant display names.
 */

export interface AttendeeEntry {
  displayName: string
  initials?: string
  isLocalSelf?: boolean
}

export function initialsFromDisplayName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 4)
}

/**
 * Map a raw UI label to a known attendee full name when possible.
 * Exact match wins; then initials; then unique prefix.
 */
export function resolveAttendeeDisplayName(
  raw: string,
  attendees: AttendeeEntry[],
): { displayName: string; matched: boolean; isLocalSelf?: boolean } {
  const label = raw.replace(/\s+/g, ' ').trim()
  if (!label || attendees.length === 0) {
    return { displayName: label, matched: false }
  }

  const lower = label.toLowerCase()
  const exact = attendees.find((a) => a.displayName.toLowerCase() === lower)
  if (exact) {
    return {
      displayName: exact.displayName,
      matched: true,
      isLocalSelf: exact.isLocalSelf,
    }
  }

  const compact = label.replace(/[\s.]/g, '').toUpperCase()
  const byInitials = attendees.filter((a) => {
    const ini = (a.initials ?? initialsFromDisplayName(a.displayName))
      .replace(/[\s.]/g, '')
      .toUpperCase()
    return ini === compact
  })
  if (byInitials.length === 1) {
    const hit = byInitials[0]!
    return {
      displayName: hit.displayName,
      matched: true,
      isLocalSelf: hit.isLocalSelf,
    }
  }

  const prefixes = attendees.filter(
    (a) =>
      a.displayName.toLowerCase().startsWith(lower) ||
      lower.startsWith(a.displayName.toLowerCase().split(' ')[0] ?? ''),
  )
  if (prefixes.length === 1 && label.length >= 2) {
    const hit = prefixes[0]!
    return {
      displayName: hit.displayName,
      matched: true,
      isLocalSelf: hit.isLocalSelf,
    }
  }

  return { displayName: label, matched: false }
}
