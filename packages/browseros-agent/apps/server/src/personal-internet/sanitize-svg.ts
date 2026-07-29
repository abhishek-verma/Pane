/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Aggressive SVG allowlist for Personalised Internet pages.
 * Agent-authored markup is never trusted; strip scripts, handlers, and
 * external resource URLs before persist / render.
 */

const MAX_SVG_CHARS = 64 * 1024

const FORBIDDEN_TAGS =
  /<\/?(?:script|foreignObject|iframe|object|embed|link|meta|style|use)\b/i

const FORBIDDEN_ATTR =
  /\s(?:on\w+|xlink:href|href|src|data)\s*=\s*(['"]?)\s*(?:javascript:|data:text\/html)/i

const ANY_HANDLER = /\son\w+\s*=/i

const EXTERNAL_URL = /\s(?:href|xlink:href|src)\s*=\s*(['"])\s*https?:/i

/** Returns cleaned SVG markup or throws Error with a clear message. */
export function sanitizePiSvg(markup: string, path = 'svg'): string {
  if (typeof markup !== 'string' || !markup.trim()) {
    throw new Error(`${path}: svg markup required`)
  }
  if (markup.length > MAX_SVG_CHARS) {
    throw new Error(`${path}: svg exceeds ${MAX_SVG_CHARS} chars`)
  }

  let cleaned = markup.trim()
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '')
  if (FORBIDDEN_TAGS.test(cleaned)) {
    throw new Error(`${path}: forbidden SVG element`)
  }
  if (ANY_HANDLER.test(cleaned) || FORBIDDEN_ATTR.test(cleaned)) {
    throw new Error(`${path}: forbidden SVG attribute`)
  }
  if (EXTERNAL_URL.test(cleaned)) {
    throw new Error(`${path}: external URLs not allowed in SVG`)
  }
  if (/javascript:/i.test(cleaned) || /<script/i.test(cleaned)) {
    throw new Error(`${path}: unsafe SVG content`)
  }

  if (!/<svg[\s>]/i.test(cleaned)) {
    throw new Error(`${path}: markup must include an <svg> root`)
  }

  cleaned = cleaned.replace(/\sxmlns:xlink\s*=\s*(['"]).*?\1/gi, '')

  return cleaned
}

export const PI_MAX_SVG_CHARS = MAX_SVG_CHARS
export const PI_MAX_MERMAID_CHARS = 16 * 1024
export const PI_MAX_CHART_POINTS = 24
