/**
 * Side-panel chat markdown with Mermaid fences routed to the sandbox broker.
 * Streamdown stays plugins={{}} so Mermaid never loads in the privileged bundle.
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
            return (
              <MessageResponse
                key={key}
                mode="streaming"
                parseIncompleteMarkdown
                plugins={{}}
              >
                {`\`\`\`mermaid\n${part.source}\n\`\`\``}
              </MessageResponse>
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
