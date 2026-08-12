/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Isolated Shiki tokenizer. Must not import React, app routing, analytics,
 * storage, or chat modules — only Shiki + this protocol. Mirrors
 * mermaid-sandbox.sandbox/main.ts's isolation reasoning: grammar/theme
 * loading and tokenization run here so a pathological input (huge code
 * block, unusual grammar) can only ever hang or blow up this disposable
 * sandbox process, never the privileged extension renderer.
 *
 * Unlike the mermaid sandbox (fresh iframe per render, since a bad diagram
 * is the common case worth isolating per-attempt), this sandbox keeps a
 * single long-lived Shiki highlighter instance across the sandbox's whole
 * lifetime — grammar/theme loading is the expensive part, not each
 * individual highlight call, so re-creating it per request would defeat
 * the point. The broker (shiki-sandbox-broker.ts) recycles the whole
 * sandbox iframe if a request ever times out, on the assumption that a
 * hung tokenizer call is not safely resumable.
 */

import {
  createJavaScriptRegexEngine,
  getSingletonHighlighter,
  type ShikiTransformer,
} from 'shiki'
import {
  isShikiHighlightHtmlRequest,
  isShikiHighlightRequest,
  SHIKI_PROTOCOL_VERSION,
  type ShikiHighlightHtmlRequest,
  type ShikiHighlightHtmlResponse,
  type ShikiHighlightRequest,
  type ShikiHighlightResponse,
  type ShikiSandboxReady,
} from '../../lib/code-highlight/shiki-protocol'

// Avoids any question about WASM compilation under the sandbox's CSP —
// the sandbox page grants 'wasm-unsafe-eval' already, but the JS engine
// removes the variable entirely for a component that otherwise has no need
// for WASM's speed advantage at this scale.
const highlighterPromise = getSingletonHighlighter({
  engine: createJavaScriptRegexEngine(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function reply(
  target: Window,
  msg: ShikiHighlightResponse | ShikiHighlightHtmlResponse,
): void {
  target.postMessage(msg, '*')
}

// Duplicated from code-block.tsx's lineNumberTransformer rather than shared
// — transformers are plain functions, not structured-cloneable across the
// postMessage boundary, so the sandbox needs its own copy to run inside
// codeToHtml() locally instead of receiving one from the caller.
const lineNumberTransformer: ShikiTransformer = {
  name: 'line-numbers',
  line(node, line) {
    node.children.unshift({
      type: 'element',
      tagName: 'span',
      properties: {
        className: [
          'inline-block',
          'min-w-10',
          'mr-4',
          'text-right',
          'select-none',
          'text-muted-foreground',
        ],
      },
      children: [{ type: 'text', value: String(line) }],
    })
  },
}

async function handleHighlight(
  sourceWindow: Window,
  req: ShikiHighlightRequest,
): Promise<void> {
  try {
    const highlighter = await highlighterPromise
    const result = highlighter.codeToTokens(req.code, {
      lang: req.language,
      themes: { light: req.themes[0], dark: req.themes[1] },
    })
    reply(sourceWindow, {
      type: 'pane-shiki-result',
      version: SHIKI_PROTOCOL_VERSION,
      requestId: req.requestId,
      ok: true,
      result: {
        tokens: result.tokens.map((line) =>
          line.map((token) => ({
            content: token.content,
            offset: token.offset,
            color: token.color,
            bgColor: token.bgColor,
            htmlAttrs: isRecord(token.htmlAttrs)
              ? (token.htmlAttrs as Record<string, string>)
              : undefined,
            htmlStyle: isRecord(token.htmlStyle)
              ? (token.htmlStyle as Record<string, string>)
              : undefined,
          })),
        ),
        fg: result.fg,
        bg: result.bg,
        rootStyle: result.rootStyle,
      },
    })
  } catch (e) {
    reply(sourceWindow, {
      type: 'pane-shiki-result',
      version: SHIKI_PROTOCOL_VERSION,
      requestId: req.requestId,
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to highlight code',
    })
  }
}

async function handleHighlightHtml(
  sourceWindow: Window,
  req: ShikiHighlightHtmlRequest,
): Promise<void> {
  try {
    const highlighter = await highlighterPromise
    const html = highlighter.codeToHtml(req.code, {
      lang: req.language,
      theme: req.theme,
      transformers: req.showLineNumbers ? [lineNumberTransformer] : [],
    })
    reply(sourceWindow, {
      type: 'pane-shiki-html-result',
      version: SHIKI_PROTOCOL_VERSION,
      requestId: req.requestId,
      ok: true,
      html,
    })
  } catch (e) {
    reply(sourceWindow, {
      type: 'pane-shiki-html-result',
      version: SHIKI_PROTOCOL_VERSION,
      requestId: req.requestId,
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to highlight code',
    })
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (!event.source || event.source === window) return
  if (isShikiHighlightRequest(event.data)) {
    void handleHighlight(event.source as Window, event.data)
    return
  }
  if (isShikiHighlightHtmlRequest(event.data)) {
    void handleHighlightHtml(event.source as Window, event.data)
  }
})

const ready: ShikiSandboxReady = {
  type: 'pane-shiki-ready',
  version: SHIKI_PROTOCOL_VERSION,
}
window.parent.postMessage(ready, '*')
