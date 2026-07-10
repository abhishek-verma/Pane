/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  assertSkillFetchUrlAllowed,
  isPrivateOrReservedHostname,
} from './skill-url'

describe('skill-url SSRF helpers', () => {
  it('flags private and link-local hosts', () => {
    expect(isPrivateOrReservedHostname('10.0.0.1')).toBe(true)
    expect(isPrivateOrReservedHostname('192.168.1.1')).toBe(true)
    expect(isPrivateOrReservedHostname('172.16.5.1')).toBe(true)
    expect(isPrivateOrReservedHostname('169.254.169.254')).toBe(true)
    expect(isPrivateOrReservedHostname('127.0.0.1')).toBe(true)
    expect(isPrivateOrReservedHostname('example.com')).toBe(false)
  })

  it('allows https public and loopback http', () => {
    expect(() =>
      assertSkillFetchUrlAllowed(new URL('https://example.com/SKILL.md')),
    ).not.toThrow()
    expect(() =>
      assertSkillFetchUrlAllowed(new URL('http://localhost:8787/SKILL.md')),
    ).not.toThrow()
  })

  it('rejects private https and non-loopback http', () => {
    expect(() =>
      assertSkillFetchUrlAllowed(new URL('https://169.254.169.254/latest')),
    ).toThrow(/private|reserved/i)
    expect(() =>
      assertSkillFetchUrlAllowed(new URL('http://192.168.0.1/SKILL.md')),
    ).toThrow(/https/i)
    expect(() =>
      assertSkillFetchUrlAllowed(new URL('ftp://example.com/SKILL.md')),
    ).toThrow(/https/i)
  })
})
