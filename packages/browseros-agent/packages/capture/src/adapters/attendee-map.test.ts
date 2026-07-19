/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  initialsFromDisplayName,
  resolveAttendeeDisplayName,
} from './attendee-map'

describe('attendee-map (P3)', () => {
  const roster = [
    { displayName: 'Ada Lovelace', initials: 'AL' },
    { displayName: 'Bob Martinez', initials: 'BM' },
    { displayName: 'You', initials: 'Y', isLocalSelf: true },
  ]

  it('computes initials', () => {
    expect(initialsFromDisplayName('Ada Lovelace')).toBe('AL')
    expect(initialsFromDisplayName('Jean-Luc Picard')).toBe('JP')
  })

  it('resolves exact names', () => {
    expect(resolveAttendeeDisplayName('Ada Lovelace', roster)).toEqual({
      displayName: 'Ada Lovelace',
      matched: true,
      isLocalSelf: undefined,
    })
  })

  it('resolves initials to unique full name', () => {
    expect(resolveAttendeeDisplayName('AL', roster)).toEqual({
      displayName: 'Ada Lovelace',
      matched: true,
      isLocalSelf: undefined,
    })
    expect(resolveAttendeeDisplayName('B.M.', roster).displayName).toBe(
      'Bob Martinez',
    )
  })

  it('leaves ambiguous initials unresolved', () => {
    const dup = [
      { displayName: 'Ann Lee', initials: 'AL' },
      { displayName: 'Ada Lovelace', initials: 'AL' },
    ]
    expect(resolveAttendeeDisplayName('AL', dup)).toEqual({
      displayName: 'AL',
      matched: false,
    })
  })

  it('resolves unique first-name prefix', () => {
    expect(resolveAttendeeDisplayName('Bob', roster).displayName).toBe(
      'Bob Martinez',
    )
  })
})
