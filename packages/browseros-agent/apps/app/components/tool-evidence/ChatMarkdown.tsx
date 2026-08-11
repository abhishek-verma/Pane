/**
 * Side-panel chat markdown. Mermaid fences are routed to the sandboxed
 * ChatMermaidBlock via Streamdown's own `plugins.renderers` extension point
 * — Streamdown checks it before ever reaching its own built-in Mermaid
 * renderer, for every code block ITS real CommonMark-compliant parser
 * assigns `language: "mermaid"`, streaming or not.
 *
 * This replaced a hand-rolled regex that pre-split ```mermaid fences out of
 * the text before handing the rest to Streamdown. That regex only matched
 * exactly 3 backticks; CommonMark fences can use any run of 3+ backticks or
 * tildes (models commonly escalate to 4+ when a diagram's own source could
 * contain a triple-backtick), so a fence the regex missed still looked like
 * a real fence to Streamdown's own parser and reached its built-in Mermaid
 * renderer uncaught — crashing the whole panel with React error #185. A
 * regex trying to shadow a real parser's fence rules is a permanent source
 * of exactly this kind of gap; letting Streamdown's own parser decide, and
 * only overriding what it does with the result, cannot disagree with itself.
 */

import type { FC } from 'react'
import type { PluginConfig } from 'streamdown'
import { MessageResponse } from '@/components/ai-elements/message'
import { ChatMermaidStreamdownRenderer } from '@/components/tool-evidence/ChatMermaidBlock'

const MERMAID_RENDERER_PLUGINS: PluginConfig = {
  renderers: [
    { language: 'mermaid', component: ChatMermaidStreamdownRenderer },
  ],
}

export const ChatMarkdown: FC<{
  text: string
  isStreaming: boolean
  segmentKey: string
}> = ({ text, isStreaming, segmentKey }) => {
  return (
    <MessageResponse
      key={segmentKey}
      mode={isStreaming ? 'streaming' : 'static'}
      parseIncompleteMarkdown={isStreaming}
      plugins={MERMAID_RENDERER_PLUGINS}
    >
      {text}
    </MessageResponse>
  )
}
