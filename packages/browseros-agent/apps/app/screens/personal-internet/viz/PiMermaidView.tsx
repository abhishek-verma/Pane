/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { useMermaidRender } from '@/lib/personal-internet/useMermaidRender'
import type { PiNode } from '../types'

type MermaidNode = Extract<PiNode, { type: 'mermaid' }>

export const PiMermaidView: FC<{ node: MermaidNode }> = ({ node }) => {
  const { svg, error, retryable, retry } = useMermaidRender(node.source)

  return (
    <figure className="overflow-x-auto border-border border-y py-4">
      {node.title ? (
        <figcaption className="mb-3 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          {node.title}
        </figcaption>
      ) : null}
      {error ? (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words text-destructive text-xs">
              {error}
            </pre>
            {retryable && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={retry}
              >
                Retry
              </Button>
            )}
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
            {node.source}
          </pre>
        </div>
      ) : svg ? (
        <div
          className="pi-mermaid flex justify-center [&_svg]:max-w-full"
          // Mermaid output is generated under securityLevel:strict in a
          // disposable sandbox iframe — still scoped to this container.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid strict SVG
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p className="text-muted-foreground text-xs">Rendering diagram…</p>
      )}
    </figure>
  )
}
