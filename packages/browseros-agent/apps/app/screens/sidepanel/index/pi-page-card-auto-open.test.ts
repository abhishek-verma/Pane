import { beforeEach, describe, expect, it, mock } from 'bun:test'

const openPiHrefCalls: string[] = []
const searchCalls: unknown[] = []
let openPiHrefResult: { tabId: number; windowId: number } | null = {
  tabId: 7,
  windowId: 3,
}

mock.module('@/lib/personal-internet/open-pi-href', () => ({
  openPiHref: async (href: string) => {
    openPiHrefCalls.push(href)
    return openPiHrefResult
  },
}))

mock.module('@/lib/messaging/sidepanel/openSidepanelWithSearch', () => ({
  openSidePanelWithSearch: async (action: string, props: unknown) => {
    searchCalls.push([action, props])
  },
}))

const { autoOpenPiPageAndFollowPanel } = await import(
  './pi-page-card-auto-open'
)

describe('autoOpenPiPageAndFollowPanel', () => {
  beforeEach(() => {
    openPiHrefCalls.length = 0
    searchCalls.length = 0
    openPiHrefResult = { tabId: 7, windowId: 3 }
  })

  it('always navigates via openPiHref', async () => {
    await autoOpenPiPageAndFollowPanel('pi://sites/site_1', 'conv-1')
    expect(openPiHrefCalls).toEqual(['pi://sites/site_1'])
  })

  it('follows the panel to the target tab with the triggering conversation', async () => {
    await autoOpenPiPageAndFollowPanel('pi://sites/site_1', 'conv-1')

    expect(searchCalls).toHaveLength(1)
    const [action, props] = searchCalls[0] as [string, Record<string, unknown>]
    expect(action).toBe('open')
    expect(props.conversationId).toBe('conv-1')
    expect(props.mode).toBe('agent')
  })

  it('does not follow when openPiHref did an in-place navigation (no tab switch)', async () => {
    openPiHrefResult = null

    await autoOpenPiPageAndFollowPanel('pi://sites/site_1', 'conv-1')

    expect(searchCalls).toHaveLength(0)
  })

  it('does not follow when there is no triggering conversation', async () => {
    await autoOpenPiPageAndFollowPanel('pi://sites/site_1', null)

    expect(searchCalls).toHaveLength(0)
  })
})
