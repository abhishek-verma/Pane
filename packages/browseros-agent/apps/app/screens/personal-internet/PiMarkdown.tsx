/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Compact markdown for Personalised Internet page prose (text / note /
 * board subtitles). Reuses Streamdown so PI pages match chat rendering.
 */

import type { FC } from 'react'
import { Streamdown } from 'streamdown'
import { streamdownLinkSafety } from '@/components/ai-elements/streamdown-external-link-modal'
import { ChatMermaidStreamdownRenderer } from '@/components/tool-evidence/ChatMermaidBlock'
import { cn } from '@/lib/utils'

// `plugins={{}}` does NOT disable Streamdown's own built-in Mermaid
// renderer — that is gated by a separate top-level `mermaid` prop, not
// `plugins.mermaid` (see ChatMarkdown.tsx, which had the same
// misunderstanding and crashed with React error #185 in production).
// Registering a custom renderer for language "mermaid" is the one hook
// Streamdown checks before ever reaching its own Mermaid renderer, so any
// ```mermaid fence in PI prose goes to the same disposable sandbox iframe
// broker chat uses instead.
const MERMAID_RENDERER_PLUGINS = {
  renderers: [
    { language: 'mermaid', component: ChatMermaidStreamdownRenderer },
  ],
}

export const PiMarkdown: FC<{
  children: string
  className?: string
}> = ({ children, className }) => (
  <Streamdown
    mode="static"
    parseIncompleteMarkdown={false}
    linkSafety={streamdownLinkSafety}
    plugins={MERMAID_RENDERER_PLUGINS}
    className={cn(
      '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-0 [&_strong]:font-semibold',
      className,
    )}
  >
    {children}
  </Streamdown>
)
