/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * postMessage protocol between privileged app UI and the Shiki sandbox.
 * Mirrors mermaid-protocol.ts's shape — same reasoning, different payload.
 */

import type { BundledLanguage, ThemeInput } from 'streamdown'

export const SHIKI_PROTOCOL_VERSION = 1 as const

export const SHIKI_SANDBOX_PAGE = 'shiki-sandbox.html'

/** Matches Streamdown's `HighlightToken` — see `CodeHighlighterPlugin`. */
export type ShikiToken = {
  content: string
  offset: number
  color?: string
  bgColor?: string
  htmlAttrs?: Record<string, string>
  htmlStyle?: Record<string, string>
}

/** Matches Streamdown's `HighlightResult` — "compatible with shiki's TokensResult". */
export type ShikiHighlightPayload = {
  tokens: ShikiToken[][]
  fg?: string
  bg?: string
  rootStyle?: string | false
}

export type ShikiHighlightRequest = {
  type: 'pane-shiki-highlight'
  version: typeof SHIKI_PROTOCOL_VERSION
  requestId: string
  code: string
  language: BundledLanguage
  themes: [ThemeInput, ThemeInput]
}

export type ShikiHighlightResponse =
  | {
      type: 'pane-shiki-result'
      version: typeof SHIKI_PROTOCOL_VERSION
      requestId: string
      ok: true
      result: ShikiHighlightPayload
    }
  | {
      type: 'pane-shiki-result'
      version: typeof SHIKI_PROTOCOL_VERSION
      requestId: string
      ok: false
      error: string
    }

/**
 * Separate request kind (same sandbox, same singleton highlighter) for
 * call sites that want rendered HTML directly rather than Streamdown's
 * token stream — e.g. tool-call input/output display, which isn't going
 * through Streamdown's `plugins.code` extension point at all.
 */
export type ShikiHighlightHtmlRequest = {
  type: 'pane-shiki-highlight-html'
  version: typeof SHIKI_PROTOCOL_VERSION
  requestId: string
  code: string
  language: BundledLanguage
  theme: string
  showLineNumbers: boolean
}

export type ShikiHighlightHtmlResponse =
  | {
      type: 'pane-shiki-html-result'
      version: typeof SHIKI_PROTOCOL_VERSION
      requestId: string
      ok: true
      html: string
    }
  | {
      type: 'pane-shiki-html-result'
      version: typeof SHIKI_PROTOCOL_VERSION
      requestId: string
      ok: false
      error: string
    }

export type ShikiSandboxReady = {
  type: 'pane-shiki-ready'
  version: typeof SHIKI_PROTOCOL_VERSION
}

export function isShikiHighlightRequest(
  data: unknown,
): data is ShikiHighlightRequest {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'pane-shiki-highlight' &&
    d.version === SHIKI_PROTOCOL_VERSION &&
    typeof d.requestId === 'string' &&
    typeof d.code === 'string' &&
    typeof d.language === 'string' &&
    Array.isArray(d.themes)
  )
}

export function isShikiHighlightResponse(
  data: unknown,
): data is ShikiHighlightResponse {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'pane-shiki-result' &&
    d.version === SHIKI_PROTOCOL_VERSION &&
    typeof d.requestId === 'string' &&
    typeof d.ok === 'boolean'
  )
}

export function isShikiHighlightHtmlRequest(
  data: unknown,
): data is ShikiHighlightHtmlRequest {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'pane-shiki-highlight-html' &&
    d.version === SHIKI_PROTOCOL_VERSION &&
    typeof d.requestId === 'string' &&
    typeof d.code === 'string' &&
    typeof d.language === 'string' &&
    typeof d.theme === 'string'
  )
}

export function isShikiHighlightHtmlResponse(
  data: unknown,
): data is ShikiHighlightHtmlResponse {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'pane-shiki-html-result' &&
    d.version === SHIKI_PROTOCOL_VERSION &&
    typeof d.requestId === 'string' &&
    typeof d.ok === 'boolean'
  )
}

export function isShikiSandboxReady(data: unknown): data is ShikiSandboxReady {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'pane-shiki-ready' && d.version === SHIKI_PROTOCOL_VERSION
}

export function shikiSandboxPageUrl(): string {
  return chrome.runtime.getURL(SHIKI_SANDBOX_PAGE)
}
