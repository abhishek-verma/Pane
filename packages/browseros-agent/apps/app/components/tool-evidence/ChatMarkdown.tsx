/**
 * Side-panel chat markdown with Mermaid fences routed to the sandbox broker.
 * A completed mermaid fence must never be handed to MessageResponse/streamdown
 * as literal text (plugins={{}} does not stop it from parsing/rendering a
 * fenced code block) — it must always go to the sandboxed ChatMermaidBlock,
 * even mid-stream.
 */

import { type FC, useMemo } from 'react'
import { MessageResponse } from '@/components/ai-elements/message'
import { ChatMermaidBlock } from '@/components/tool-evidence/ChatMermaidBlock'
import { splitChatMarkdownMermaid } from '@/lib/tool-evidence/split-chat-markdown-mermaid'

export const ChatMarkdown: FC<{
  text: string
  isStreaming: boolean
  segmentKey: string
}> = ({ text, isStreaming, segmentKey }) => {
  const parts = useMemo(() => splitChatMarkdownMermaid(text), [text])
  const hasCompleteMermaid = parts.some((p) => p.type === 'mermaid')

  // Incomplete fences (still streaming) stay as plain markdown so we do not
  // spin up sandbox iframes on every token.
  if (isStreaming && !hasCompleteMermaid) {
    return (
      <MessageResponse mode="streaming" parseIncompleteMarkdown plugins={{}}>
        {text}
      </MessageResponse>
    )
  }

  return (
    <>
      {parts.map((part, index) => {
        const key = `${segmentKey}-${part.type}-${index}`
        if (part.type === 'mermaid') {
          if (isStreaming) {
            // Never hand a fenced mermaid source string to MessageResponse:
            // even with plugins={{}}, that is markdown text streamdown
            // parses — this is the only place that used to happen, and it
            // loaded streamdown's own privileged-bundle Mermaid renderer
            // instead of the sandboxed one below, crashing with React error
            // #185 almost every turn. Stay off Streamdown entirely until the
            // sandboxed ChatMermaidBlock takes over once streaming ends.
            return (
              <div
                key={key}
                className="my-2 rounded-md border border-border/60 bg-muted/20 p-3"
              >
                <p className="text-muted-foreground text-xs">
                  Rendering diagram…
                </p>
              </div>
            )
          }
          return <ChatMermaidBlock key={key} source={part.source} />
        }
        if (!part.text) return null
        return (
          <MessageResponse
            key={key}
            mode={isStreaming ? 'streaming' : 'static'}
            parseIncompleteMarkdown={isStreaming}
            plugins={{}}
          >
            {part.text}
          </MessageResponse>
        )
      })}
    </>
  )
}
