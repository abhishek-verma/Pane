/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import type { PiNode } from '../types'

type SvgNode = Extract<PiNode, { type: 'svg' }>

/**
 * Client-side belt-and-suspenders check mirroring server sanitizePiSvg.
 * Markup should already be sanitized at validatePageDoc time.
 */
function isSafeSvgMarkup(markup: string): boolean {
  if (!/<svg[\s>]/i.test(markup)) return false
  if (
    /<\/?(?:script|foreignObject|iframe|object|embed|link|meta|style|use)\b/i.test(
      markup,
    )
  )
    return false
  if (/\son\w+\s*=/i.test(markup)) return false
  if (/javascript:/i.test(markup)) return false
  if (/\s(?:href|xlink:href|src)\s*=\s*(['"])\s*https?:/i.test(markup))
    return false
  return true
}

export const PiSvgView: FC<{ node: SvgNode }> = ({ node }) => {
  const safe = isSafeSvgMarkup(node.markup)
  return (
    <figure className="overflow-x-auto rounded-lg border border-border/70 bg-card/30 p-3">
      {node.title ? (
        <figcaption className="mb-2 font-medium text-foreground text-sm">
          {node.title}
        </figcaption>
      ) : null}
      {safe ? (
        <div
          className="pi-svg flex justify-center [&_svg]:max-h-96 [&_svg]:max-w-full"
          role="img"
          aria-label={node.alt ?? node.title ?? 'Diagram'}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: server+client sanitized SVG
          dangerouslySetInnerHTML={{ __html: node.markup }}
        />
      ) : (
        <p className="text-destructive text-xs">SVG blocked — unsafe markup.</p>
      )}
    </figure>
  )
}
