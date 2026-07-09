/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * CDP Token — security boundary for Chrome DevTools Protocol connections.
 *
 * The Chromium patch already binds the CDP WebSocket exclusively to
 * 127.0.0.1 (see CDPServerSocketFactory in browseros_server_manager.cc),
 * meaning CDP is never reachable from outside the machine. This module
 * adds a defense-in-depth token so that local processes — which share the
 * same loopback interface — still cannot connect to CDP without presenting
 * the session token written to server.json at startup.
 *
 * Usage (server startup):
 *   import { generateCdpToken } from './lib/cdp-token'
 *   const cdpToken = generateCdpToken()
 *   await writeServerConfig({ ..., cdp_token: cdpToken })
 *
 * Usage (connection validation):
 *   import { validateCdpToken, getCdpToken } from './lib/cdp-token'
 *   if (!validateCdpToken(requestToken)) { reject() }
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS } from '@browseros/shared/constants/paths'
import { getBrowserosDir } from './browseros-dir'

/** Generates a cryptographically random CDP session token. */
export function generateCdpToken(): string {
  return crypto.randomUUID()
}

/**
 * Reads the CDP token from the server.json discovery file.
 *
 * Returns `null` if the file does not exist, cannot be parsed, or does not
 * contain a `cdp_token` field. Callers should treat `null` as "token unknown"
 * and reject the connection rather than allowing access.
 */
export function getCdpToken(): string | null {
  const configPath = join(getBrowserosDir(), PATHS.SERVER_CONFIG_FILE_NAME)

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'cdp_token' in parsed &&
      typeof (parsed as Record<string, unknown>).cdp_token === 'string'
    ) {
      const token = (parsed as Record<string, unknown>).cdp_token as string
      return token.length > 0 ? token : null
    }

    return null
  } catch {
    return null
  }
}

/**
 * Returns `true` when `token` matches the session token in server.json.
 *
 * Timing: this is a simple string equality check because both values originate
 * from a UUID (fixed 36-byte string). A constant-time comparison would not
 * add meaningful security here given that an attacker with local access can
 * trivially read server.json themselves. The primary threat model is accidental
 * access by unrelated local processes, not a sophisticated timing attack.
 *
 * Returns `false` when:
 *  - `token` is empty or whitespace-only.
 *  - server.json cannot be read or does not contain a `cdp_token`.
 *  - `token` does not exactly match the stored token.
 */
export function validateCdpToken(token: string): boolean {
  if (!token?.trim()) {
    return false
  }

  const stored = getCdpToken()
  if (stored === null) {
    return false
  }

  return token === stored
}
