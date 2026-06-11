import { Bot, Cpu, Sparkles, Wand2 } from 'lucide-react'
import type { FC } from 'react'
import type { HarnessAgentAdapter } from '@/modules/agents/agent-harness-types'

/**
 * Single icon component for any adapter the agent rail can render.
 * Falls back to a generic bot when the adapter is unknown so future
 * adapters land without a code change at the call site.
 */
export interface AdapterIconProps {
  adapter: HarnessAgentAdapter | 'unknown'
  className?: string
}

export const AdapterIcon: FC<AdapterIconProps> = ({ adapter, className }) => {
  switch (adapter) {
    case 'claude':
      // Claude Code — text-based agent, sparkles to evoke the "AI assistant" feel.
      return <Sparkles className={className} aria-label="Claude Code" />
    case 'codex':
      // Codex — code-leaning, CPU mark.
      return <Cpu className={className} aria-label="Codex" />
    case 'hermes':
      // Hermes — messenger god framing, wand evokes the agentic conjuring.
      return <Wand2 className={className} aria-label="Hermes" />
    default:
      return <Bot className={className} aria-label="Agent" />
  }
}

export function adapterLabel(adapter: HarnessAgentAdapter | 'unknown'): string {
  switch (adapter) {
    case 'claude':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    case 'hermes':
      return 'Hermes'
    default:
      return 'Agent'
  }
}
