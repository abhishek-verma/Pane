/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useEffect, useId, useState } from 'react'
import type { PiNode } from '../types'

type MermaidNode = Extract<PiNode, { type: 'mermaid' }>

export const PiMermaidView: FC<{ node: MermaidNode }> = ({ node }) => {
  const reactId = useId().replace(/:/g, '')
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSvg(null)
    setError(null)
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'neutral',
        })
        const id = `pi-mmd-${reactId}`
        const { svg: rendered } = await mermaid.render(id, node.source)
        if (!cancelled) setSvg(rendered)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to render diagram')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [node.source, reactId])

  return (
    <figure className="overflow-x-auto border-border border-y py-4">
      {node.title ? (
        <figcaption className="mb-3 font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          {node.title}
        </figcaption>
      ) : null}
      {error ? (
        <pre className="whitespace-pre-wrap text-destructive text-xs">
          {error}
        </pre>
      ) : svg ? (
        <div
          className="pi-mermaid flex justify-center [&_svg]:max-w-full"
          // Mermaid output is generated under securityLevel:strict from
          // validated source — still scoped to this container.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid strict SVG
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <p className="text-muted-foreground text-xs">Rendering diagram…</p>
      )}
    </figure>
  )
}
