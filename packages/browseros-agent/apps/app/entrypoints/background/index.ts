import { storage } from '@wxt-dev/storage'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { Capabilities } from '@/lib/browseros/capabilities'
import { getHealthCheckUrl, getMcpServerUrl } from '@/lib/browseros/helpers'
import {
  ensureSidePanelRuntimeStateLoaded,
  openSidePanel,
  registerSidePanelOpenStateListeners,
  setSidePanelPerWindowPreference,
  toggleSidePanel,
} from '@/lib/browseros/toggleSidePanel'
import { checkAndShowChangelog } from '@/lib/changelog/changelog-notifier'
import {
  setupLlmProvidersBackupToBrowserOS,
  setupLlmProvidersSyncToBackend,
} from '@/lib/llm-providers/storage'
import { fetchMcpTools } from '@/lib/mcp/client'
import {
  onRuntimeMessage,
  RuntimeMessageType,
} from '@/lib/messaging/runtime/runtimeMessages'
import { onServerMessage } from '@/lib/messaging/server/serverMessages'
import { onOpenSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { setupScheduledJobsSyncToBackend } from '@/lib/schedules/syncSchedulesToBackend'
import { searchActionsStorage } from '@/lib/search-actions/searchActionsStorage'
import { selectedTextStorage } from '@/lib/selected-text/selectedTextStorage'
import { stopAgentStorage } from '@/lib/stop-agent/stop-agent-storage'
import { drainOsPush } from './drainOsPush'
import { drainServerRuns } from './drainServerRuns'
import { scheduledJobRuns } from './scheduledJobRuns'

const LEGACY_TOOL_APPROVAL_STORAGE_KEYS = [
  'local:tool-approval-config',
  'local:pending-tool-approvals',
  'local:approval-responses',
  'local:tool-execution-log',
] as const

/**
 * Removes persisted state for the unshipped Tool Approvals feature during extension updates.
 */
const cleanupLegacyToolApprovalStorage = async () => {
  await storage.removeItems([...LEGACY_TOOL_APPROVAL_STORAGE_KEYS])
}

export default defineBackground(() => {
  registerSidePanelOpenStateListeners()
  ensureSidePanelRuntimeStateLoaded().catch(() => null)

  Capabilities.initialize().catch(() => null)
  setupLlmProvidersBackupToBrowserOS()
  setupLlmProvidersSyncToBackend()
  setupScheduledJobsSyncToBackend()

  scheduledJobRuns()
  drainServerRuns()
  drainOsPush()

  chrome.action.onClicked.addListener(async (tab) => {
    if (typeof tab.id === 'number' && typeof tab.windowId === 'number') {
      await toggleSidePanel({ tabId: tab.id, windowId: tab.windowId })
    }
  })

  onOpenSidePanelWithSearch('open', async (messageData) => {
    const currentTabsList = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    })
    const currentTab = currentTabsList?.[0]
    if (
      typeof currentTab?.id === 'number' &&
      typeof currentTab.windowId === 'number'
    ) {
      const { opened } = await openSidePanel({
        tabId: currentTab.id,
        windowId: currentTab.windowId,
      })

      if (opened) {
        setTimeout(() => {
          searchActionsStorage.setValue(messageData.data)
        }, 500)
      }
    }
  })

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
      chrome.tabs.create({
        url: chrome.runtime.getURL('app.html#/onboarding'),
      })
    }

    if (details.reason === chrome.runtime.OnInstalledReason.UPDATE) {
      cleanupLegacyToolApprovalStorage().catch(() => null)
      checkAndShowChangelog().catch(() => null)
    }
  })

  onRuntimeMessage(RuntimeMessageType.getTabId, ({ sender }) => {
    return { tabId: sender.tab?.id }
  })

  onRuntimeMessage(RuntimeMessageType.stopAgent, async ({ data }) => {
    await stopAgentStorage.setValue({
      conversationId: data.conversationId,
      timestamp: Date.now(),
    })
  })

  onRuntimeMessage(
    RuntimeMessageType.sidePanelScopeChanged,
    async ({ data }) => {
      await setSidePanelPerWindowPreference(data.perWindow)
    },
  )

  chrome.tabs.onRemoved.addListener((tabId) => {
    const key = String(tabId)
    selectedTextStorage.getValue().then((map) => {
      if (map[key]) {
        const { [key]: _, ...rest } = map
        selectedTextStorage.setValue(rest)
      }
    })
  })

  onServerMessage('checkHealth', async () => {
    try {
      const url = await getHealthCheckUrl()
      const response = await fetch(url)
      return { healthy: response.ok }
    } catch {
      return { healthy: false }
    }
  })

  onServerMessage('fetchMcpTools', async () => {
    try {
      const url = await getMcpServerUrl()
      const tools = await fetchMcpTools(url)
      return { tools }
    } catch (err) {
      return {
        tools: [],
        error: err instanceof Error ? err.message : 'Failed to fetch tools',
      }
    }
  })

  // M1.7 Process supervision: SW health-checks + relaunch
  const healthCheckLoop = async () => {
    let failures = 0
    while (true) {
      // Check every 30 seconds
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      try {
        const url = await getHealthCheckUrl()
        const res = await fetch(url)
        if (res.ok) {
          failures = 0
        } else {
          failures++
        }
      } catch (_err) {
        failures++
      }

      if (failures >= 3) {
        try {
          // Setting the restart requested pref triggers the native Chromium process to relaunch the server
          await getBrowserOSAdapter().setPref(
            'browseros.server.restart_requested',
            true,
          )
          failures = 0 // Reset to avoid constant restart requests
        } catch (_e) {
          // Native API may not be available
        }
      }
    }
  }

  // Start the loop without awaiting it
  healthCheckLoop().catch(() => null)
})
