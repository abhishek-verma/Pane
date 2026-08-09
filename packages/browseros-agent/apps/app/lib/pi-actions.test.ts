import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { SearchActionStorage } from '@/lib/search-actions/searchActionsStorage'
import type { PiAction } from '@/screens/personal-internet/types'

const fetchActiveChatTurn = mock(
  async (): Promise<{ status: string } | null> => null,
)
const executeWidgetAction = mock(async () => {})
const openSidePanelWithSearch = mock(
  async (_type: 'open', _payload: SearchActionStorage) => {},
)
const storageState = new Map<string, unknown>()

// Include every export chat-turn-api.ts has, not just what this file needs —
// mock.module replaces the module in the shared registry for the whole bun
// test process, so an incomplete stub here would break other test files
// (e.g. chat-turn-controller.test.ts) that import the other exports.
mock.module('@/lib/conversations/chat-turn-api', () => ({
  fetchActiveChatTurn,
  cancelChatTurn: mock(async () => ({ cancelled: true })),
  attachChatTurnStream: mock(async () => {}),
}))
mock.module('@/lib/widget-actions', () => ({ executeWidgetAction }))
mock.module('@/lib/messaging/sidepanel/openSidepanelWithSearch', () => ({
  openSidePanelWithSearch,
}))
// activeRepairStorage wraps @wxt-dev/storage, which requires a real
// extension `browser` global unavailable under bun:test — mock the
// storage backend (not activeRepairStorage itself) so its real
// get/set/clear logic is still exercised end-to-end through pi-actions.
mock.module('@wxt-dev/storage', () => ({
  storage: {
    getItem: async (key: string) => storageState.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      storageState.set(key, value)
    },
  },
}))

const { executePiAction } = await import('./pi-actions')

const repairAction: PiAction = {
  kind: 'agent',
  query: 'Refresh and repair the Personal Internet page for Job Search.',
  metadata: {
    returnRoute: '/pi/sites/site_1/pages/page_1',
    siteId: 'site_1',
    pageId: 'page_1',
    intent: 'pi-page-refresh',
  },
}

describe('executePiAction — PI repair dedup', () => {
  beforeEach(() => {
    fetchActiveChatTurn.mockReset()
    fetchActiveChatTurn.mockImplementation(async () => null)
    executeWidgetAction.mockReset()
    openSidePanelWithSearch.mockReset()
    storageState.clear()
  })

  it('starts a fresh turn (with a query) when no repair is already running', async () => {
    await executePiAction(repairAction)
    expect(openSidePanelWithSearch).toHaveBeenCalledTimes(1)
    const [, payload] = openSidePanelWithSearch.mock.calls[0] ?? []
    expect(payload?.query).toContain('Refresh and repair')
    expect(payload?.newConversationId).toBeTruthy()
    expect(payload?.requestId).toBeTruthy()
  })

  it('reattaches by conversationId instead of starting a second turn when one is running', async () => {
    fetchActiveChatTurn.mockImplementation(async () => ({ status: 'running' }))
    // First call starts and records the in-flight conversationId.
    await executePiAction(repairAction)
    const [, firstPayload] = openSidePanelWithSearch.mock.calls[0] ?? []
    const startedConversationId = firstPayload?.newConversationId
    executeWidgetAction.mockClear()
    openSidePanelWithSearch.mockClear()
    // Second call for the same pageId must reattach, not send a new prompt.
    await executePiAction(repairAction)
    expect(openSidePanelWithSearch).toHaveBeenCalledTimes(1)
    const [, secondPayload] = openSidePanelWithSearch.mock.calls[0] ?? []
    expect(secondPayload?.conversationId).toBe(startedConversationId)
    expect(secondPayload?.query).toBe('')
  })
})
