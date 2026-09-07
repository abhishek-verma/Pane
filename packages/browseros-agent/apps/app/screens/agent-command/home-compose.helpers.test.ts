import { describe, expect, it } from 'bun:test'
import type { Provider } from '@/components/chat/chatComponentTypes'
import {
  harnessHomeText,
  resolveHomeLlmRoutingMode,
  routeHomeSend,
} from './home-compose.helpers'

const llm: Provider = {
  id: 'browseros',
  name: 'Pane',
  type: 'browseros',
  kind: 'llm',
}
const acp: Provider = {
  id: 'agent-1',
  name: 'Review bot',
  type: 'acp',
  kind: 'acp',
  agentId: 'agent-1',
}

describe('routeHomeSend', () => {
  it('routes an LLM provider to the in-tab provider chat', () => {
    expect(routeHomeSend(llm, 'hello')).toEqual({
      kind: 'llm',
      providerId: 'browseros',
      path: '/home/chat?q=hello&mode=agent',
    })
  })

  it('routes a named agent to its harness conversation', () => {
    expect(
      routeHomeSend(acp, 'do a thing', {
        agentSessionId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      kind: 'acp',
      agentId: 'agent-1',
      path: '/home/agents/agent-1/sessions/00000000-0000-4000-8000-000000000001?q=do%20a%20thing',
    })
  })

  it('encodes special characters in the query', () => {
    expect(routeHomeSend(llm, 'a & b?')?.path).toBe(
      '/home/chat?q=a%20%26%20b%3F&mode=agent',
    )
  })

  it('includes selected tab ids for LLM chat handoff', () => {
    expect(
      routeHomeSend(llm, 'summarize these', {
        selectedTabs: [
          { id: 11 } as chrome.tabs.Tab,
          { url: 'https://browseros.com' } as chrome.tabs.Tab,
          { id: 12 } as chrome.tabs.Tab,
        ],
      })?.path,
    ).toBe('/home/chat?q=summarize%20these&mode=agent&tabs=11,12')
  })

  it('returns null for an empty prompt', () => {
    expect(routeHomeSend(llm, '   ')).toBeNull()
  })

  it('returns null for a malformed acp target with no agentId', () => {
    const acpNoId: Provider = {
      id: 'agent-x',
      name: 'Broken',
      type: 'acp',
      kind: 'acp',
    }
    expect(
      routeHomeSend(acpNoId, 'hello', {
        agentSessionId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toBeNull()
  })

  it('returns null for an acp target without a session id', () => {
    expect(routeHomeSend(acp, 'hello')).toBeNull()
  })
})

describe('resolveHomeLlmRoutingMode', () => {
  it('waits for capability initialization before falling back', () => {
    expect(
      resolveHomeLlmRoutingMode({
        capabilitiesLoading: true,
        supportsInlineChat: false,
      }),
    ).toBe('wait')
  })

  it('uses inline chat when capability checks pass', () => {
    expect(
      resolveHomeLlmRoutingMode({
        capabilitiesLoading: false,
        supportsInlineChat: true,
      }),
    ).toBe('inline-chat')
  })

  it('falls back after capability checks finish unsupported', () => {
    expect(
      resolveHomeLlmRoutingMode({
        capabilitiesLoading: false,
        supportsInlineChat: false,
      }),
    ).toBe('sidepanel')
  })
})

it('routes attachment-only Home submissions with a usable prompt', () => {
  const text = harnessHomeText('', [], true)
  expect(routeHomeSend(acp, text, { agentSessionId: 'files' })?.path).toContain(
    'attached%20files',
  )
})
it('carries the selected tab references into the harness message', () => {
  const text = harnessHomeText('Summarize these', [
    {
      id: 11,
      title: 'Research',
      url: 'https://example.test/research',
    } as chrome.tabs.Tab,
  ])
  expect(text).toContain('Summarize these')
  expect(text).toContain('Research: https://example.test/research')
})
