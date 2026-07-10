/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Skill URL allowlist helpers (SSRF hardening for install-from-URL).
 */

/** Loopback hosts allowed for http(s) skill fetch in tests / local fixtures. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1'
  )
}

function ipv4Octets(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return nums
}

/** True for RFC1918, link-local, loopback, and unique-local IPv6. */
export function isPrivateOrReservedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (isLoopbackHostname(host)) return true
  if (host === '0.0.0.0' || host === '::' || host.endsWith('.localhost')) {
    return true
  }

  const v4 = ipv4Octets(host)
  if (v4) {
    const [a, b] = v4
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }

  // IPv6 unique-local / link-local
  if (host.startsWith('fc') || host.startsWith('fd')) return true
  if (host.startsWith('fe80:')) return true
  return false
}

/**
 * Skill fetch URL policy:
 * - https to public hosts
 * - http(s) to loopback only (tests / local fixtures)
 * - never other private / link-local hosts (SSRF)
 */
export function assertSkillFetchUrlAllowed(url: URL): void {
  const protocol = url.protocol
  const loopback = isLoopbackHostname(url.hostname)

  if (protocol === 'http:') {
    if (!loopback) {
      throw new Error(
        'Skill URL must be https:// (or http://localhost for tests)',
      )
    }
    return
  }

  if (protocol !== 'https:') {
    throw new Error(
      'Skill URL must be https:// (or http://localhost for tests)',
    )
  }

  if (isPrivateOrReservedHostname(url.hostname) && !loopback) {
    throw new Error('Skill URL host is not allowed (private or reserved)')
  }
}
