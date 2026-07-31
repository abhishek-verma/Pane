/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useEffect, useState } from 'react'
import { PI_MERMAID_RENDER_ENABLED } from '@/lib/personal-internet/mermaid-render-enabled'
import { renderMermaidInSandbox } from '@/lib/personal-internet/mermaid-sandbox-broker'
import type { PiNode } from '../types'

type MermaidNode = Extract<PiNode, { type: 'mermaid' }>

export const PiMermaidView: FC<{ node: MermaidNode }> = ({ node }) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setSvg(null)
    setError(null)
    if (typeof node.source !== 'string' || !node.source.trim()) {
      setError('Missing diagram source')
      return
    }
    if (!PI_MERMAID_RENDER_ENABLED) {
      setError('Diagram rendering disabled')
      return
    }
    void (async () => {
      const result = await renderMermaidInSandbox(node.source, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (result.ok) {
        setSvg(result.svg)
        setError(null)
      } else if (result.error !== 'cancelled') {
        setError(result.error)
      }
    })()
    return () => {
      controller.abort()
    }
  }, [node.source])

  return (
    <figure className="overflow-x-auto border-border border-y py-4">
      {node.title ? (
        <figcaption className="mb-3 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          {node.title}
        </figcaption>
      ) : null}
      {error ? (
        <div className="space-y-2">
          <pre className="whitespace-pre-wrap text-destructive text-xs">
            {error}
          </pre>
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
