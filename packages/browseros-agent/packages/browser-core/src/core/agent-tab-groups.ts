import type { TabGroup } from '../tab-groups'
import type { CdpConnection } from './connection'

const groupingQueues = new WeakMap<CdpConnection, Promise<unknown>>()

export const DEFAULT_AGENT_TAB_GROUP_TITLE = 'Tabs opened by Pane'
// Chromium exposes named colors, not arbitrary brand values. Green is the
// supported match for Pane's lime signal accent.
export const DEFAULT_AGENT_TAB_GROUP_COLOR = 'green'

/** One shared fallback per window; explicit task folders remain task-scoped. */
export class AgentTabGroups {
  private readonly groups = new Map<string, string>()
  private readonly owners = new Map<
    string,
    { windowId: number; tabs: Set<number> }
  >()

  constructor(private readonly cdp: CdpConnection) {}

  async add(
    tabId: number,
    windowId: number,
    scope: string,
    preferred?: string,
  ): Promise<void> {
    // Tabs can be opened in parallel. Serialize discovery/creation so the first
    // two tabs cannot each create their own folder.
    const work = (groupingQueues.get(this.cdp) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const key = `${scope}:${windowId}`
        const { groups } = (await this.cdp.Browser.getTabGroups()) as {
          groups: TabGroup[]
        }
        // Remove closed groups, keeping the cache bounded by actual browser state.
        for (const [id, groupId] of this.groups) {
          if (groups.some((g) => g.groupId === groupId)) continue
          // Models sometimes explicitly regroup their tabs after opening them.
          // Follow that named group instead of splitting the next open away.
          const owner = this.owners.get(id)
          const moved =
            owner &&
            groups.find(
              (g) =>
                g.windowId === owner.windowId &&
                g.tabIds.some((tab) => owner.tabs.has(tab)),
            )
          if (moved) this.groups.set(id, moved.groupId)
          else {
            this.groups.delete(id)
            this.owners.delete(id)
          }
        }
        const groupId = preferred ?? this.groups.get(key)
        const group =
          groups.find(
            (g) =>
              g.groupId === groupId &&
              g.windowId === windowId &&
              (this.groups.get(key) === g.groupId || isPaneGroupTitle(g.title)),
          ) ??
          groups.find(
            (g) =>
              g.windowId === windowId &&
              g.title === DEFAULT_AGENT_TAB_GROUP_TITLE,
          )
        if (group) {
          try {
            await this.cdp.Browser.addTabsToGroup({
              groupId: group.groupId,
              tabIds: [tabId],
            })
            await this.cdp.Browser.updateTabGroup({
              groupId: group.groupId,
              title: paneGroupTitle(group.title),
              ...(paneGroupTitle(group.title) ===
                DEFAULT_AGENT_TAB_GROUP_TITLE && {
                color: DEFAULT_AGENT_TAB_GROUP_COLOR,
              }),
            })
            this.remember(key, group.groupId, windowId, tabId)
            return
          } catch (error) {
            // Only recreate a group that disappeared. A transient attachment or
            // label failure must not create another fallback alongside it.
            const current = (await this.cdp.Browser.getTabGroups()) as {
              groups: TabGroup[]
            }
            if (current.groups.some((g) => g.groupId === group.groupId))
              throw error
            this.groups.delete(key)
          }
        }
        const { group: created } = (await this.cdp.Browser.createTabGroup({
          tabIds: [tabId],
          title: DEFAULT_AGENT_TAB_GROUP_TITLE,
        })) as { group: TabGroup }
        this.remember(key, created.groupId, windowId, tabId)
        await this.cdp.Browser.updateTabGroup({
          groupId: created.groupId,
          color: DEFAULT_AGENT_TAB_GROUP_COLOR,
        })
      })
    groupingQueues.set(this.cdp, work)
    return work
  }

  private remember(
    key: string,
    groupId: string,
    windowId: number,
    tabId: number,
  ): void {
    const tabs =
      this.groups.get(key) === groupId
        ? (this.owners.get(key)?.tabs ?? new Set<number>())
        : new Set<number>()
    this.groups.set(key, groupId)
    tabs.add(tabId)
    this.owners.set(key, { windowId, tabs })
  }
}

/** Keep the ownership label even when a model omits or clears the name. */
export function paneGroupTitle(title?: string): string {
  const clean = title?.trim()
  if (!clean) return DEFAULT_AGENT_TAB_GROUP_TITLE
  return isPaneGroupTitle(clean) ? clean : `Pane · ${clean}`
}

function isPaneGroupTitle(title: string): boolean {
  return (
    title === DEFAULT_AGENT_TAB_GROUP_TITLE ||
    /^Pane(?:\s*[·:—-]|$)/i.test(title)
  )
}
