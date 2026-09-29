import { expect, it, mock } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const passthrough = ({ children }: { children: ReactNode }) => children
let session = {
  providers: [] as Array<{ id: string; name: string; type: string }>,
  selectedProvider: undefined as
    | { id: string; name: string; type: string }
    | undefined,
  handleSelectProvider: () => {},
  resetConversation: () => {},
  messages: [],
  isLoading: true,
}
mock.module('react-router', () => ({
  useLocation: () => ({ pathname: '/' }),
  Outlet: () => <div>Chat content</div>,
}))
mock.module('@/modules/chat/chat-session-context', () => ({
  ChatSessionProvider: passthrough,
  useChatSessionContext: () => session,
}))
mock.module('@/components/chat/ChatSessionCrashBoundary', () => ({
  ChatSessionCrashBoundary: passthrough,
}))
mock.module('@/components/chat/ChatProviderSelector', () => ({
  ChatProviderSelector: passthrough,
}))
mock.module('@/components/chat/ChatHistoryPopover', () => ({
  ChatHistoryPopover: () => <button type="button">History</button>,
}))
mock.module('@/components/credits/CreditBadge', () => ({
  CreditBadge: () => null,
}))
mock.module('@/modules/credits/credits.hooks', () => ({
  useCredits: () => ({}),
}))
mock.module('@/modules/browseros/capabilities.hooks', () => ({
  useCapabilities: () => ({ supports: () => false }),
}))
mock.module('@/lib/browseros/capabilities', () => ({ Feature: {} }))
mock.module('@/lib/llm-providers/providerIcons', () => ({
  ProviderIcon: () => null,
}))
mock.module('@/screens/layers/LayersButton', () => ({
  LayersButton: () => null,
}))
const { ChatLayout } = await import('./ChatLayout')

it('keeps New Chat, history, settings and chat content mounted while providers load', () => {
  const html = renderToStaticMarkup(<ChatLayout />)
  expect(html).toContain('New conversation')
  expect(html).toContain('History')
  expect(html).toContain('Settings')
  expect(html).toContain('Chat content')
})

it('keeps New Chat available with a Codex provider and no loaded messages', () => {
  const codex = { id: 'codex', name: 'Codex', type: 'codex' }
  session = {
    ...session,
    isLoading: false,
    providers: [codex],
    selectedProvider: codex,
  }
  const html = renderToStaticMarkup(<ChatLayout />)
  expect(html).toContain('Codex')
  expect(html).toContain('New conversation')
  expect(html).toContain('Chat content')
})
