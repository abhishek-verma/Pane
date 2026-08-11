/**
 * Chat Mermaid diagram via disposable sandbox iframe (not Streamdown's own
 * bundled Mermaid renderer, which has crashed the whole panel with React
 * error #185 from inside its own rendering code before).
 */

import { type FC, useEffect, useState } from 'react'
import type { CustomRenderer, CustomRendererProps } from 'streamdown'
import { PI_MERMAID_RENDER_ENABLED } from '@/lib/personal-internet/mermaid-render-enabled'
import { renderMermaidInSandbox } from '@/lib/personal-internet/mermaid-sandbox-broker'

const MermaidRenderingPlaceholder: FC<{ sandboxed?: boolean }> = ({
  sandboxed,
}) => (
  <div
    className={
      sandboxed
        ? 'my-2 overflow-x-auto rounded-md border border-border/60 bg-muted/20 p-3'
        : 'my-2 rounded-md border border-border/60 bg-muted/20 p-3'
    }
  >
    <p className="text-muted-foreground text-xs">Rendering diagram…</p>
  </div>
)

export const ChatMermaidBlock: FC<{ source: string }> = ({ source }) => {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setSvg(null)
    setError(null)
    if (!source.trim()) {
      setError('Missing diagram source')
      return
    }
    if (!PI_MERMAID_RENDER_ENABLED) {
      setError('Diagram rendering disabled')
      return
    }
    void (async () => {
      const result = await renderMermaidInSandbox(source, {
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
  }, [source])

  return (
    <div className="my-2 overflow-x-auto rounded-md border border-border/60 bg-muted/20 p-3">
      {error ? (
        <div className="space-y-2">
          <pre className="whitespace-pre-wrap text-destructive text-xs">
            {error}
          </pre>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
            {source}
          </pre>
        </div>
      ) : svg ? (
        <div
          className="chat-mermaid flex justify-center [&_svg]:max-w-full"
          // Mermaid output is generated under securityLevel:strict in a
          // disposable sandbox iframe — still scoped to this container.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid strict SVG
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <MermaidRenderingPlaceholder sandboxed />
      )}
    </div>
  )
}

/**
 * Registered as Streamdown's `plugins.renderers` entry for `language:
 * "mermaid"` — see MERMAID_RENDERER_PLUGINS below. Streamdown checks a
 * matching custom renderer before it ever reaches its own built-in Mermaid
 * diagram plugin, so this is the one place in the render path that
 * determines whether a mermaid fence goes to the sandbox or to Streamdown's
 * own renderer, keyed off Streamdown's real (CommonMark-compliant) fence
 * parsing rather than a hand-rolled regex trying to approximate it.
 */
export const ChatMermaidStreamdownRenderer: FC<CustomRendererProps> = ({
  code,
  isIncomplete,
}) => {
  if (isIncomplete) return <MermaidRenderingPlaceholder />
  return <ChatMermaidBlock source={code} />
}

/**
 * Shared by every Streamdown instance that can render arbitrary model text
 * (ChatMarkdown, PiMarkdown, reasoning.tsx) — one definition so they can't
 * drift out of sync with each other.
 */
export const MERMAID_RENDERER_PLUGINS: {
  renderers: CustomRenderer[]
} = {
  renderers: [
    { language: 'mermaid', component: ChatMermaidStreamdownRenderer },
  ],
}

/**
 * Streamdown's own custom-renderer lookup matches `language` with a plain
 * `===` (verified against its bundled source — no case-folding anywhere in
 * that path), and the language token comes from the fence's info string
 * verbatim. A ```Mermaid or ```MERMAID fence would silently fall through
 * to a plain code block instead of the sandboxed diagram. Streamdown's own
 * parser still decides where the fence begins/ends (that's the point of
 * this whole approach) — this only canonicalizes the language token's case
 * beforehand, it does not re-detect fence boundaries.
 */
const MERMAID_FENCE_LANGUAGE_RE = /^([ \t]*(?:`{3,}|~{3,})[ \t]*)mermaid\b/gim

export function normalizeMermaidFenceCase(text: string): string {
  return text.replace(
    MERMAID_FENCE_LANGUAGE_RE,
    (_match, prefix: string) => `${prefix}mermaid`,
  )
}
