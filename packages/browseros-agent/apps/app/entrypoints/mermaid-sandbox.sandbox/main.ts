/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Isolated Mermaid renderer. Must not import React, app routing, analytics,
 * storage, or chat modules — only Mermaid + this protocol.
 */

import { PI_LIMITS } from '@browseros/shared/constants/limits'
import mermaid from 'mermaid'
import {
  MERMAID_PROTOCOL_VERSION,
  type MermaidRenderRequest,
  type MermaidRenderResponse,
  type MermaidSandboxReady,
} from '../../lib/personal-internet/mermaid-protocol'

let initialized = false

function ensureInit(): void {
  if (initialized) return
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: 'neutral',
    // Mermaid accepts these runtime caps though they are not on every typings build.
    ...({
      maxTextSize: PI_LIMITS.MAX_MERMAID_CHARS,
      maxEdges: PI_LIMITS.MAX_MERMAID_EDGES,
    } as Record<string, unknown>),
  })
  initialized = true
}

function isRenderRequest(data: unknown): data is MermaidRenderRequest {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return (
    d.type === 'pane-mermaid-render' &&
    d.version === MERMAID_PROTOCOL_VERSION &&
    typeof d.requestId === 'string' &&
    typeof d.source === 'string'
  )
}

function reply(target: Window, msg: MermaidRenderResponse): void {
  target.postMessage(msg, '*')
}

async function handleRender(
  sourceWindow: Window,
  req: MermaidRenderRequest,
): Promise<void> {
  try {
    if (req.source.length > PI_LIMITS.MAX_MERMAID_CHARS) {
      reply(sourceWindow, {
        type: 'pane-mermaid-result',
        version: MERMAID_PROTOCOL_VERSION,
        requestId: req.requestId,
        ok: false,
        error: `mermaid exceeds ${PI_LIMITS.MAX_MERMAID_CHARS} chars`,
      })
      return
    }
    ensureInit()
    const id = `mmd-${req.requestId.replace(/[^a-zA-Z0-9_-]/g, '')}`
    const { svg } = await mermaid.render(id, req.source)
    if (svg.length > PI_LIMITS.MAX_MERMAID_SVG_CHARS) {
      reply(sourceWindow, {
        type: 'pane-mermaid-result',
        version: MERMAID_PROTOCOL_VERSION,
        requestId: req.requestId,
        ok: false,
        error: 'mermaid svg exceeds budget',
      })
      return
    }
    reply(sourceWindow, {
      type: 'pane-mermaid-result',
      version: MERMAID_PROTOCOL_VERSION,
      requestId: req.requestId,
      ok: true,
      svg,
    })
  } catch (e) {
    reply(sourceWindow, {
      type: 'pane-mermaid-result',
      version: MERMAID_PROTOCOL_VERSION,
      requestId: req.requestId,
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to render diagram',
    })
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (!event.source || event.source === window) return
  if (!isRenderRequest(event.data)) return
  void handleRender(event.source as Window, event.data)
})

const ready: MermaidSandboxReady = {
  type: 'pane-mermaid-ready',
  version: MERMAID_PROTOCOL_VERSION,
}
window.parent.postMessage(ready, '*')
