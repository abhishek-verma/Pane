/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import {
  generateCdpToken,
  getCdpToken,
  validateCdpToken,
} from '../../src/lib/cdp-token'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempBrowserosDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cdp-token-test-'))
  return dir
}

function writeServerJson(dir: string, payload: unknown): void {
  writeFileSync(
    join(dir, PATHS.SERVER_CONFIG_FILE_NAME),
    JSON.stringify(payload, null, 2),
    'utf-8',
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateCdpToken', () => {
  it('returns a non-empty string', () => {
    const token = generateCdpToken()
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  it('returns a valid UUID v4 format', () => {
    const token = generateCdpToken()
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(uuidRegex.test(token)).toBe(true)
  })

  it('returns a unique token on every call', () => {
    const tokens = new Set(Array.from({ length: 20 }, generateCdpToken))
    expect(tokens.size).toBe(20)
  })
})

describe('getCdpToken', () => {
  let tempDir: string
  const originalBrowserosDir = process.env.BROWSEROS_DIR

  beforeEach(() => {
    tempDir = makeTempBrowserosDir()
    process.env.BROWSEROS_DIR = tempDir
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    if (originalBrowserosDir === undefined) {
      delete process.env.BROWSEROS_DIR
    } else {
      process.env.BROWSEROS_DIR = originalBrowserosDir
    }
  })

  it('returns null when server.json does not exist', () => {
    expect(getCdpToken()).toBeNull()
  })

  it('returns null when server.json has no cdp_token field', () => {
    writeServerJson(tempDir, {
      server_port: 9069,
      url: 'http://127.0.0.1:9069',
      server_version: '1.0.0',
    })
    expect(getCdpToken()).toBeNull()
  })

  it('returns null when cdp_token is an empty string', () => {
    writeServerJson(tempDir, { cdp_token: '' })
    expect(getCdpToken()).toBeNull()
  })

  it('returns null when cdp_token is not a string', () => {
    writeServerJson(tempDir, { cdp_token: 12345 })
    expect(getCdpToken()).toBeNull()
  })

  it('returns null when server.json contains invalid JSON', () => {
    const configPath = join(tempDir, PATHS.SERVER_CONFIG_FILE_NAME)
    writeFileSync(configPath, 'NOT { valid json }', 'utf-8')
    expect(getCdpToken()).toBeNull()
  })

  it('returns the cdp_token value when present', () => {
    const token = generateCdpToken()
    writeServerJson(tempDir, { cdp_token: token })
    expect(getCdpToken()).toBe(token)
  })

  it('ignores extra fields in server.json', () => {
    const token = generateCdpToken()
    writeServerJson(tempDir, {
      server_port: 9069,
      cdp_port: 9070,
      url: 'http://127.0.0.1:9069',
      server_version: '0.0.1',
      cdp_token: token,
    })
    expect(getCdpToken()).toBe(token)
  })
})

describe('validateCdpToken', () => {
  let tempDir: string
  const originalBrowserosDir = process.env.BROWSEROS_DIR

  beforeEach(() => {
    tempDir = makeTempBrowserosDir()
    process.env.BROWSEROS_DIR = tempDir
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    if (originalBrowserosDir === undefined) {
      delete process.env.BROWSEROS_DIR
    } else {
      process.env.BROWSEROS_DIR = originalBrowserosDir
    }
  })

  it('returns false for an empty token string', () => {
    const stored = generateCdpToken()
    writeServerJson(tempDir, { cdp_token: stored })
    expect(validateCdpToken('')).toBe(false)
  })

  it('returns false for a whitespace-only token', () => {
    const stored = generateCdpToken()
    writeServerJson(tempDir, { cdp_token: stored })
    expect(validateCdpToken('   ')).toBe(false)
  })

  it('returns false when server.json does not exist', () => {
    expect(validateCdpToken(generateCdpToken())).toBe(false)
  })

  it('returns false when server.json has no cdp_token field', () => {
    writeServerJson(tempDir, { server_port: 9069 })
    expect(validateCdpToken(generateCdpToken())).toBe(false)
  })

  it('returns false when the token does not match', () => {
    const stored = generateCdpToken()
    writeServerJson(tempDir, { cdp_token: stored })
    const other = generateCdpToken()
    // Ensure we generated a different token (vanishingly unlikely collision)
    expect(other).not.toBe(stored)
    expect(validateCdpToken(other)).toBe(false)
  })

  it('returns false for a partial token match', () => {
    const stored = generateCdpToken()
    writeServerJson(tempDir, { cdp_token: stored })
    expect(validateCdpToken(stored.slice(0, 8))).toBe(false)
  })

  it('returns true when the token exactly matches', () => {
    const stored = generateCdpToken()
    writeServerJson(tempDir, { cdp_token: stored })
    expect(validateCdpToken(stored)).toBe(true)
  })

  it('returns false when the token matches with different casing', () => {
    const stored = generateCdpToken()
    writeServerJson(tempDir, { cdp_token: stored })
    // UUID tokens are lowercase; upper-casing should not validate
    expect(validateCdpToken(stored.toUpperCase())).toBe(false)
  })
})
