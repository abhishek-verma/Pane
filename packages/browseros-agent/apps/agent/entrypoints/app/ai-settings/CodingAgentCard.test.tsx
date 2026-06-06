import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AgentListItem } from '../agents/agents-page-types'
import { CodingAgentCard } from './CodingAgentCard'

const codexAgent: AgentListItem = {
  key: 'agent:codex-1',
  agentId: 'codex-1',
  name: 'agent',
  source: 'agent-harness',
  runtimeLabel: 'Codex',
  modelLabel: 'gpt-5.5',
  detail: 'medium',
  canChat: true,
  canDelete: true,
}

function renderCard(
  props: Partial<Parameters<typeof CodingAgentCard>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(CodingAgentCard, {
      agent: codexAgent,
      adapter: 'codex',
      modelLabel: 'gpt-5.5',
      reasoningEffort: 'medium',
      deleting: false,
      onDelete: () => {},
      ...props,
    }),
  )
}

describe('CodingAgentCard', () => {
  it('renders a Codex agent with the provider-card shell and metadata', () => {
    const html = renderCard()

    expect(html).toContain('rounded-xl border p-4')
    expect(html).toContain('agent')
    expect(html).toContain('Codex · gpt-5.5 · medium')
    expect(html).toContain('aria-label="Codex"')
  })

  it('renders delete-only actions without the rich agent row controls', () => {
    const html = renderCard()

    expect(html).toContain('aria-label="Delete agent"')
    expect(html).not.toContain('Test')
    expect(html).not.toContain('Edit')
    expect(html).not.toContain('Running')
    expect(html).not.toContain('No messages yet')
  })

  it('disables delete and renders a spinner while deleting', () => {
    const html = renderCard({ deleting: true })

    expect(html).toContain('disabled=""')
    expect(html).toContain('animate-spin')
  })
})
