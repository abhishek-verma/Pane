import type { TabGroup } from '../tab-groups'
import type { CdpConnection } from './connection'

/** One named folder per task and browser window. Shared by every agent path. */
export class AgentTabGroups {
  private readonly groups = new Map<string, string>()
  private readonly owners = new Map<
    string,
    { windowId: number; tabs: Set<number> }
  >()
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly cdp: CdpConnection) {}

  async add(
    tabId: number,
    windowId: number,
    scope: string,
    preferred?: string,
    label?: string,
  ): Promise<void> {
    // Tabs can be opened in parallel. Serialize discovery/creation so the first
    // two tabs cannot each create their own folder.
    const work = this.tail
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
        const groupId = this.groups.get(key) ?? preferred
        const group = groups.find(
          (g) =>
            g.groupId === groupId &&
            g.windowId === windowId &&
            (this.groups.has(key) || /^Pane(?:\s*[·:—-]|$)/i.test(g.title)),
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
            })
            this.remember(key, group.groupId, windowId, tabId)
            return
          } catch {
            // A user may close the group between discovery and attachment.
            this.groups.delete(key)
          }
        }
        const { group: created } = (await this.cdp.Browser.createTabGroup({
          tabIds: [tabId],
          title: paneGroupTitle(label),
        })) as { group: TabGroup }
        this.remember(key, created.groupId, windowId, tabId)
        await this.cdp.Browser.updateTabGroup({
          groupId: created.groupId,
          color: 'blue',
        })
      })
    this.tail = work
    return work
  }

  private remember(
    key: string,
    groupId: string,
    windowId: number,
    tabId: number,
  ): void {
    this.groups.set(key, groupId)
    const tabs = this.owners.get(key)?.tabs ?? new Set<number>()
    tabs.add(tabId)
    this.owners.set(key, { windowId, tabs })
  }
}

/** Keep the ownership label even when a model omits or clears the name. */
export function paneGroupTitle(title?: string): string {
  const clean = title?.trim()
  if (!clean) return 'Pane · Task'
  return /^Pane(?:\s*[·:—-]|$)/i.test(clean) ? clean : `Pane · ${clean}`
}

/** A useful fallback without exposing URL paths or query parameters. */
export function agentTabLabel(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}
