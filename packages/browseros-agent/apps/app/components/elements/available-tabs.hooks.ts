import { useEffect, useMemo, useState } from 'react'
import {
  displayTabUrl,
  isAttachableTabUrl,
} from '@/lib/personal-internet/attachable-tab-url'

export interface UseAvailableTabsOptions {
  enabled: boolean
  filterText?: string
}

export interface UseAvailableTabsResult {
  tabs: chrome.tabs.Tab[]
  allTabs: chrome.tabs.Tab[]
  isLoading: boolean
}

export function useAvailableTabs({
  enabled,
  filterText = '',
}: UseAvailableTabsOptions): UseAvailableTabsResult {
  const [allTabs, setAllTabs] = useState<chrome.tabs.Tab[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    setIsLoading(true)

    chrome.tabs
      .query({ currentWindow: true })
      .then((currentWindowTabs) => {
        if (cancelled) return
        const attachable = currentWindowTabs
          .filter((tab) => isAttachableTabUrl(tab.url))
          .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
        setAllTabs(attachable)
        setIsLoading(false)
      })
      .catch((_error) => {
        if (cancelled) return
        setAllTabs([])
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled])

  const tabs = useMemo(() => {
    if (!filterText) return allTabs
    const words = filterText.toLowerCase().trim().split(/\s+/)
    return allTabs.filter((tab) => {
      const shown = displayTabUrl(tab.url).toLowerCase()
      const haystack =
        `${tab.title ?? ''} ${tab.url ?? ''} ${shown}`.toLowerCase()
      return words.every((word) => haystack.includes(word))
    })
  }, [allTabs, filterText])

  return { tabs, allTabs, isLoading }
}
