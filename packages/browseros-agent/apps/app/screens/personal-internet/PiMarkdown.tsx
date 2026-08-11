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
import {
  MERMAID_RENDERER_PLUGINS,
  normalizeMermaidFenceCase,
} from '@/components/tool-evidence/ChatMermaidBlock'
import { cn } from '@/lib/utils'

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
    {normalizeMermaidFenceCase(children)}
  </Streamdown>
)
