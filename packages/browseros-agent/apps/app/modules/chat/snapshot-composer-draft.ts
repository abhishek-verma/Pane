import {
  displayTabUrl,
  isAttachableTabUrl,
} from '@/lib/personal-internet/attachable-tab-url'
import type { ChatDraft } from './composer-store'

/** A draft references live tabs. Freeze their current context at the explicit
 * Send action; dispatch still checks for navigation AFTER that snapshot. */
export async function snapshotComposerDraft(
  draft: ChatDraft,
): Promise<ChatDraft> {
  const tabs = await Promise.all(
    draft.tabs.map(async (tab) => {
      let current: chrome.tabs.Tab
      try {
        if (tab.id == null) throw new Error('Missing tab')
        current = await chrome.tabs.get(tab.id)
      } catch {
        throw new Error(
          `“${tab.title || 'Attached page'}” is no longer open. Remove or replace it before sending.`,
        )
      }
      if (!isAttachableTabUrl(current.url))
        throw new Error(
          `“${current.title || tab.title || 'Attached page'}” cannot be attached. Remove or replace it before sending.`,
        )
      if (displayTabUrl(current.url) !== displayTabUrl(tab.url))
        throw new Error(
          `“${tab.title || 'Attached page'}” changed since it was attached. Reselect the page before sending.`,
        )
      return current
    }),
  )
  const byId = new Map(tabs.map((tab) => [tab.id, tab]))
  const text = draft.text.replace(
    /@\[([^\]]+)\]\(tab:(\d+)\)/g,
    (token, _label, id) => {
      const tab = byId.get(Number(id))
      if (!tab) return token
      const label = (tab.title || tab.url || 'Page').replace(/[\]\n]/g, ' ')
      return `@[${label}](tab:${id})`
    },
  )
  return { ...draft, tabs, text }
}
