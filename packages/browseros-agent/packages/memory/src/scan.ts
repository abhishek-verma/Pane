/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Injection / credential scan before any memory or skill write.
 */

import type { InjectionScanResult } from './types'

const INJECTION_PATTERNS: Array<{ reason: string; re: RegExp }> = [
  {
    reason: 'prompt-injection phrase',
    re: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  },
  {
    reason: 'prompt-injection phrase',
    re: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?)/i,
  },
  {
    reason: 'system-prompt override',
    re: /you\s+are\s+now\s+(dan|unrestricted|jailbroken)/i,
  },
  {
    reason: 'credential-looking string',
    re: /\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/,
  },
  {
    reason: 'credential-looking string',
    re: /\b(api[_-]?key|secret[_-]?key|password)\s*[:=]\s*\S{8,}/i,
  },
  {
    reason: 'private key block',
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
]

/** Invisible / bidi control characters that can hide instructions. */
const INVISIBLE_UNICODE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/

export class MemoryWriteRejectedError extends Error {
  constructor(public readonly reason: string) {
    super(`Memory write rejected: ${reason}`)
    this.name = 'MemoryWriteRejectedError'
  }
}

export function scanMemoryContent(content: string): InjectionScanResult {
  if (!content?.trim()) {
    return { ok: false, reason: 'empty content' }
  }
  if (INVISIBLE_UNICODE.test(content)) {
    return { ok: false, reason: 'invisible unicode' }
  }
  for (const { reason, re } of INJECTION_PATTERNS) {
    if (re.test(content)) {
      return { ok: false, reason }
    }
  }
  return { ok: true }
}

/** Throw if content fails the injection / credential scan. */
export function assertMemoryContent(content: string): void {
  const scan = scanMemoryContent(content)
  if (!scan.ok) {
    throw new MemoryWriteRejectedError(scan.reason ?? 'scan failed')
  }
}
