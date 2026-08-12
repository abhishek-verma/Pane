/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Streamdown `plugins.code` implementation backed by the Shiki sandbox
 * broker — the same "heavy work runs off the main render thread" shape
 * already used for Mermaid (see ChatMermaidBlock.tsx's `plugins.renderers`
 * entry), applied to Streamdown's parallel extension point for code
 * highlighting. `highlight()` returns `null` immediately and resolves the
 * real result later via `callback` — Streamdown's own type for this method
 * is written for exactly this async-sandbox shape (see streamdown's
 * `CodeHighlighterPlugin`), it's just never been wired to anything in this
 * codebase before now (the built-in Shiki highlighting in Streamdown's
 * bundled component is dormant without a `plugins.code`).
 */

import { bundledLanguages } from 'shiki'
import type {
  BundledLanguage,
  BundledTheme,
  CodeHighlighterPlugin,
} from 'streamdown'
import { highlightInSandbox } from './shiki-sandbox-broker'

/** Single source of truth — also used for Streamdown's `shikiTheme` prop. */
export const STREAMDOWN_CODE_THEMES: [BundledTheme, BundledTheme] = [
  'catppuccin-latte',
  'catppuccin-mocha',
]

const SUPPORTED_LANGUAGES = Object.keys(bundledLanguages) as BundledLanguage[]
const SUPPORTED_LANGUAGE_SET = new Set<string>(SUPPORTED_LANGUAGES)

export const shikiWorkerPlugin: CodeHighlighterPlugin = {
  name: 'shiki',
  type: 'code-highlighter',
  getSupportedLanguages: () => SUPPORTED_LANGUAGES,
  supportsLanguage: (language) => SUPPORTED_LANGUAGE_SET.has(language),
  getThemes: () => STREAMDOWN_CODE_THEMES,
  highlight: (options, callback) => {
    void highlightInSandbox(
      options.code,
      options.language,
      options.themes,
    ).then((res) => {
      // On failure, don't call back — Streamdown keeps rendering the raw
      // fence text it already shows while a result is pending, the same
      // fallback it uses for "not ready yet". No amount of code content
      // makes this worse: it just stays unhighlighted, never blocking.
      if (res.ok) callback?.(res.value)
    })
    return null
  },
}
