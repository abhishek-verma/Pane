import type { TabGroup } from '../tab-groups'
import type { CdpConnection } from './connection'

/** One named folder per task and browser window. Shared by every agent path. */
export class AgentTabGroups {
  private readonly groups = new Map<string, string>()
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly cdp: CdpConnection) {}

  async add(
    tabId: number,
    windowId: number,
    scope: string,
    preferred?: string,
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
          if (!groups.some((g) => g.groupId === groupId)) this.groups.delete(id)
        }
        const groupId = this.groups.get(key) ?? preferred
        const group = groups.find(
          (g) => g.groupId === groupId && g.windowId === windowId,
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
            this.groups.set(key, group.groupId)
            return
          } catch {
            // A user may close the group between discovery and attachment.
            this.groups.delete(key)
          }
        }
        const { group: created } = (await this.cdp.Browser.createTabGroup({
          tabIds: [tabId],
          title: 'Pane · Task',
        })) as { group: TabGroup }
        this.groups.set(key, created.groupId)
        await this.cdp.Browser.updateTabGroup({
          groupId: created.groupId,
          color: 'blue',
        })
      })
    this.tail = work
    return work
  }
}

/** Keep the ownership label even when a model omits or clears the name. */
export function paneGroupTitle(title?: string): string {
  const clean = title?.trim()
  if (!clean) return 'Pane · Task'
  return /^Pane(?:\s*[·:—-]|$)/i.test(clean) ? clean : `Pane · ${clean}`
}
