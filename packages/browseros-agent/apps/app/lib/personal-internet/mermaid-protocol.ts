/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * postMessage protocol between privileged PI UI and the Mermaid sandbox.
 */

export const MERMAID_PROTOCOL_VERSION = 1 as const

export const MERMAID_SANDBOX_PAGE = 'mermaid-sandbox.html'

export type MermaidRenderRequest = {
  type: 'pane-mermaid-render'
  version: typeof MERMAID_PROTOCOL_VERSION
  requestId: string
  source: string
}

export type MermaidRenderResponse =
  | {
      type: 'pane-mermaid-result'
      version: typeof MERMAID_PROTOCOL_VERSION
      requestId: string
      ok: true
      svg: string
    }
  | {
      type: 'pane-mermaid-result'
      version: typeof MERMAID_PROTOCOL_VERSION
      requestId: string
      ok: false
      error: string
    }

export type MermaidSandboxReady = {
  type: 'pane-mermaid-ready'
  version: typeof MERMAID_PROTOCOL_VERSION
}

export function isMermaidRenderResponse(
  data: unknown,
): data is MermaidRenderResponse {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'pane-mermaid-result' &&
    d.version === MERMAID_PROTOCOL_VERSION &&
    typeof d.requestId === 'string' &&
    typeof d.ok === 'boolean'
  )
}

export function isMermaidSandboxReady(
  data: unknown,
): data is MermaidSandboxReady {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'pane-mermaid-ready' && d.version === MERMAID_PROTOCOL_VERSION
  )
}

export function sandboxPageUrl(): string {
  return chrome.runtime.getURL(MERMAID_SANDBOX_PAGE)
}
