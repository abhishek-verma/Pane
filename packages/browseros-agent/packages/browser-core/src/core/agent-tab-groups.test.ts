import { describe, expect, test } from 'bun:test'
import type { TabGroup } from '../tab-groups'
import { AgentTabGroups, paneGroupTitle } from './agent-tab-groups'
import { withAgentTabScope } from './agent-tab-scope'
import type { CdpConnection } from './connection'
import { PageManager } from './pages'
import { BrowserSession } from './session'

function harness() {
  const groups: TabGroup[] = []
  const closed: number[] = []
  let nextId = 0
  let failCreate = false
  const cdp = {
    isConnected: () => true,
    connectionEpoch: () => 1,
    Target: { on: () => {} },
    Browser: {
      getTabGroups: async () => ({ groups }),
      createTabGroup: async ({
        tabIds,
        title,
      }: {
        tabIds: number[]
        title: string
      }) => {
        if (failCreate) throw new Error('Grouping unavailable')
        const group = {
          groupId: `g${++nextId}`,
          tabIds,
          title,
          windowId: tabIds[0] < 10 ? 1 : 2,
          color: 'grey',
          collapsed: false,
        }
        groups.push(group)
        return { group }
      },
      addTabsToGroup: async ({
        groupId,
        tabIds,
      }: {
        groupId: string
        tabIds: number[]
      }) => {
        const group = groups.find((g) => g.groupId === groupId)
        if (!group) throw new Error('Group was closed')
        group.tabIds.push(...tabIds)
        return { group }
      },
      updateTabGroup: async (params: Partial<TabGroup>) => {
        const group = groups.find((g) => g.groupId === params.groupId)
        if (!group) throw new Error('Group was closed')
        Object.assign(group, params)
        return { group }
      },
      createTab: async () => ({ tab: { tabId: 1, windowId: 1 } }),
      getTabInfo: async () => ({
        tab: { tabId: 1, windowId: 1, isLoading: false, loadProgress: 1 },
      }),
      closeTab: async ({ tabId }: { tabId: number }) => {
        closed.push(tabId)
      },
    },
  } as unknown as CdpConnection
  return {
    groups,
    closed,
    cdp,
    manager: new AgentTabGroups(cdp),
    fail: () => {
      failCreate = true
    },
  }
}

describe('automatic Pane folders', () => {
  test('follows a model-created replacement folder on later opens', async () => {
    const { manager, groups } = harness()
    await manager.add(1, 1, 'task')
    groups[0].groupId = 'regrouped'
    groups[0].title = 'Pane · Trip research'
    await manager.add(2, 1, 'task')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      groupId: 'regrouped',
      title: 'Pane · Trip research',
      tabIds: [1, 2],
    })
  })

  test('a preferred personal folder is never used for automatic task tabs', async () => {
    const { manager, groups } = harness()
    groups.push({
      groupId: 'personal',
      title: 'Personal',
      tabIds: [99],
      windowId: 1,
      color: 'red',
      collapsed: false,
    })
    await manager.add(1, 1, 'task', 'personal')
    expect(groups[0].tabIds).toEqual([99])
    expect(groups[1].title).toBe('Tabs opened by Pane')
  })
  test('run-style direct newPage calls inherit ownership and cannot clear it', async () => {
    const { cdp, groups } = harness()
    const pages = new PageManager(cdp)
    await withAgentTabScope({ agentScope: 'task' }, async () => {
      await Promise.resolve()
      await pages.newPage('https://example.com', { agentScope: '' })
    })
    expect(groups[0].title).toBe('Tabs opened by Pane')
  })
  test('raw CDP cannot silently open tabs outside the managed creation path', async () => {
    const { cdp } = harness()
    const browser = new BrowserSession(cdp)
    await withAgentTabScope({ agentScope: 'task' }, async () => {
      await expect(
        browser.cdp('Browser.createTab', { url: 'about:blank' }),
      ).rejects.toThrow('browser.pages.newPage')
      await expect(
        browser.cdpJson('Target.createTarget', '{"url":"about:blank"}'),
      ).rejects.toThrow('browser.pages.newPage')
    })
  })

  test('parallel opens share one named folder and do not absorb personal tabs', async () => {
    const { manager, groups } = harness()
    groups.push({
      groupId: 'personal',
      title: 'Personal',
      tabIds: [99],
      windowId: 1,
      color: 'red',
      collapsed: false,
    })
    await Promise.all([
      manager.add(1, 1, 'task'),
      manager.add(2, 1, 'other-task'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].tabIds).toEqual([99])
    expect(groups[1]).toMatchObject({
      title: 'Tabs opened by Pane',
      color: 'green',
      tabIds: [1, 2],
    })
  })
  test('shares the fallback across conversations, keeping browser windows separate', async () => {
    const { manager, groups } = harness()
    await manager.add(1, 1, 'first')
    await manager.add(2, 1, 'second')
    await manager.add(10, 2, 'first')
    expect(groups).toHaveLength(2)
    expect(groups[0].tabIds).toEqual([1, 2])
    expect(groups[1].tabIds).toEqual([10])
    expect(groups.every((group) => group.title === 'Tabs opened by Pane')).toBe(
      true,
    )
  })
  test('recreates a deleted folder and repairs an empty label', async () => {
    const { manager, groups } = harness()
    await manager.add(1, 1, 'task')
    groups.length = 0
    await manager.add(2, 1, 'task')
    expect(groups[0].groupId).toBe('g2')
    groups[0].title = ' '
    await manager.add(3, 1, 'task')
    expect(groups[0].title).toBe('Tabs opened by Pane')
    expect(groups[0].tabIds).toEqual([2, 3])
  })
  test('concurrent managers on the same browser connection share the fallback', async () => {
    const { manager, cdp, groups } = harness()
    const other = new AgentTabGroups(cdp)
    await Promise.all([manager.add(1, 1, 'first'), other.add(2, 1, 'second')])
    expect(groups).toHaveLength(1)
    expect(groups[0].tabIds).toEqual([1, 2])
  })
  test('reusing an existing fallback applies the brand color without recoloring personal folders', async () => {
    const { manager, cdp, groups } = harness()
    await manager.add(1, 1, 'first')
    groups[0].color = 'blue'
    groups.push({
      groupId: 'personal',
      title: 'Personal',
      tabIds: [9],
      windowId: 1,
      color: 'red',
      collapsed: false,
    })
    await new AgentTabGroups(cdp).add(2, 1, 'second')
    expect(groups[0].color).toBe('green')
    expect(groups[1].color).toBe('red')
  })
  test('reuses the shared fallback after the manager restarts', async () => {
    const { manager, cdp, groups } = harness()
    await manager.add(1, 1, 'first')
    await new AgentTabGroups(cdp).add(2, 1, 'second')
    expect(groups).toHaveLength(1)
    expect(groups[0].tabIds).toEqual([1, 2])
  })
  test('an explicit named group takes precedence without capturing other tasks', async () => {
    const { manager, groups } = harness()
    await manager.add(1, 1, 'first')
    groups.push({
      groupId: 'research',
      title: 'Pane · Research',
      tabIds: [8],
      windowId: 1,
      color: 'purple',
      collapsed: false,
    })
    await manager.add(2, 1, 'first', 'research')
    await manager.add(3, 1, 'first')
    await manager.add(4, 1, 'second')
    expect(groups).toHaveLength(2)
    expect(groups[0].tabIds).toEqual([1, 4])
    expect(groups[1].tabIds).toEqual([8, 2, 3])
    expect(groups[1].color).toBe('purple')
  })
  test('different websites use the same fallback through page creation', async () => {
    const { cdp, groups } = harness()
    let id = 0
    cdp.Browser.createTab = async () =>
      ({ tab: { tabId: ++id, windowId: 1 } }) as never
    cdp.Browser.getTabInfo = async (params) =>
      ({
        tab: {
          tabId: params?.tabId ?? id,
          windowId: 1,
          isLoading: false,
          loadProgress: 1,
        },
      }) as never
    const pages = new PageManager(cdp)
    await pages.newPage('https://example.com', { agentScope: 'first' })
    await pages.newPage('https://another.example', { agentScope: 'second' })
    await pages.newPage('about:blank', { agentScope: 'third' })
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      title: 'Tabs opened by Pane',
      tabIds: [1, 2, 3],
    })
  })
  test('ignores a stale or different-window preferred group', async () => {
    const { manager, groups } = harness()
    await manager.add(10, 2, 'other')
    await manager.add(1, 1, 'task', groups[0].groupId)
    expect(groups[0].tabIds).toEqual([10])
    expect(groups[1].tabIds).toEqual([1])
  })
  test('attachment failures do not create duplicate fallback folders', async () => {
    const { manager, cdp, groups } = harness()
    await manager.add(1, 1, 'first')
    cdp.Browser.addTabsToGroup = async () => {
      throw new Error('Attachment failed')
    }
    await expect(manager.add(2, 1, 'second')).rejects.toThrow(
      'Attachment failed',
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].tabIds).toEqual([1])
  })
  test('closes only the just-created tab when mandatory grouping fails', async () => {
    const { cdp, fail, closed } = harness()
    fail()
    const pages = new PageManager(cdp)
    await expect(
      pages.newPage('about:blank', { agentScope: 'task' }),
    ).rejects.toThrow('The new tab was closed')
    expect(closed).toEqual([1])
    expect(pages.getInfo(1)).toBeUndefined()
  })
  test('organizes before waiting for load and publishes the page only after success', async () => {
    const { cdp, groups } = harness()
    const pages = new PageManager(cdp)
    const id = await pages.newPage('about:blank', { agentScope: 'task' })
    expect(groups[0].tabIds).toEqual([1])
    expect(pages.getInfo(id)?.tabId).toBe(1)
  })
  test('labels omitted and blank model titles and preserves descriptive labels', () => {
    expect(paneGroupTitle()).toBe('Tabs opened by Pane')
    expect(paneGroupTitle('  ')).toBe('Tabs opened by Pane')
    expect(paneGroupTitle('Tabs opened by Pane')).toBe('Tabs opened by Pane')
    expect(paneGroupTitle('Research')).toBe('Pane · Research')
    expect(paneGroupTitle('Pane · Research')).toBe('Pane · Research')
  })
})
