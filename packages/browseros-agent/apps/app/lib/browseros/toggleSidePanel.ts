import {
  openWindowSidePanelIdsStorage,
  sidePanelPerWindowStorage,
} from './sidePanelOpenStateStorage'

const SIDEPANEL_PATH = 'sidepanel.html'
const openWindowSidePanelIds = new Set<number>()
let sidePanelPerWindow = false
let sidePanelOpenStateListenersRegistered = false
let sidePanelRuntimeStateLoaded = false
let sidePanelRuntimeStateLoadPromise: Promise<void> | null = null
let sidePanelScopePreferenceEpoch = 0
let persistWindowSidePanelOpenStatePromise: Promise<void> = Promise.resolve()

export type SidePanelTarget = {
  tabId: number
  windowId: number
}

export type SidePanelToggleResult = {
  opened: boolean
}

/** Applies the cached side panel scope and keeps Chromium's global panel options in sync. */
export async function setSidePanelPerWindowPreference(
  perWindow: boolean,
): Promise<void> {
  const epoch = sidePanelScopePreferenceEpoch + 1
  sidePanelScopePreferenceEpoch = epoch
  await applySidePanelPerWindowPreference(perWindow, epoch)
}

async function applySidePanelPerWindowPreference(
  perWindow: boolean,
  epoch: number,
): Promise<void> {
  if (epoch !== sidePanelScopePreferenceEpoch) return
  await chrome.sidePanel.setOptions(
    perWindow ? { enabled: true, path: SIDEPANEL_PATH } : { enabled: false },
  )
  if (epoch !== sidePanelScopePreferenceEpoch) return
  sidePanelPerWindow = perWindow
}

async function loadSidePanelScopePreference(): Promise<void> {
  const epoch = sidePanelScopePreferenceEpoch
  try {
    const perWindow = await sidePanelPerWindowStorage.getValue()
    await applySidePanelPerWindowPreference(perWindow, epoch)
  } catch {
    await applySidePanelPerWindowPreference(false, epoch)
  }
}

async function loadWindowSidePanelOpenState(): Promise<void> {
  const windowIds = await openWindowSidePanelIdsStorage.getValue()
  openWindowSidePanelIds.clear()
  for (const windowId of windowIds) {
    if (Number.isInteger(windowId)) {
      openWindowSidePanelIds.add(windowId)
    }
  }
}

function queuePersistWindowSidePanelOpenState(): Promise<void> {
  const windowIds = [...openWindowSidePanelIds]
  persistWindowSidePanelOpenStatePromise =
    persistWindowSidePanelOpenStatePromise
      .catch(() => undefined)
      .then(() => openWindowSidePanelIdsStorage.setValue(windowIds))
  return persistWindowSidePanelOpenStatePromise
}

/**
 * Callers must await this. MV3 service workers can be killed within
 * ~30s of going idle, and Chrome only extends a listener's lifetime while
 * it has a pending promise outstanding — a fire-and-forget write here can
 * lose the race and never reach storage. If that happens, the next cold
 * worker reloads a stale (missing) window ID from storage and believes
 * this window's panel is closed when it is actually open: a toolbar click
 * meant to close it then takes the "open" branch instead (chrome.sidePanel
 * .open() again, no close() ever sent) — which looks exactly like clicking
 * close reopening the panel.
 */
function rememberWindowSidePanelOpen(windowId: number): Promise<void> {
  if (openWindowSidePanelIds.has(windowId)) return Promise.resolve()
  openWindowSidePanelIds.add(windowId)
  return queuePersistWindowSidePanelOpenState()
}

/** See rememberWindowSidePanelOpen — same must-await requirement. */
function rememberWindowSidePanelClosed(windowId: number): Promise<void> {
  if (!openWindowSidePanelIds.delete(windowId)) return Promise.resolve()
  return queuePersistWindowSidePanelOpenState()
}

/** Refreshes the cached side panel scope and open-window state from storage. */
export async function refreshSidePanelRuntimeState(): Promise<void> {
  await Promise.all([
    loadSidePanelScopePreference(),
    loadWindowSidePanelOpenState(),
  ])
  sidePanelRuntimeStateLoaded = true
}

/** Serializes background startup state before a user-triggered side panel action routes. */
export async function ensureSidePanelRuntimeStateLoaded(): Promise<void> {
  if (sidePanelRuntimeStateLoaded) return
  sidePanelRuntimeStateLoadPromise ??= refreshSidePanelRuntimeState()
    .catch((error) => {
      sidePanelRuntimeStateLoaded = false
      throw error
    })
    .finally(() => {
      sidePanelRuntimeStateLoadPromise = null
    })
  await sidePanelRuntimeStateLoadPromise
}

async function openTabSidePanel({
  tabId,
}: SidePanelTarget): Promise<SidePanelToggleResult> {
  const isAlreadyOpen = await chrome.sidePanel.browserosIsOpen({ tabId })
  if (isAlreadyOpen) {
    return { opened: true }
  }
  return await chrome.sidePanel.browserosToggle({ tabId })
}

async function toggleTabSidePanel({
  tabId,
}: SidePanelTarget): Promise<SidePanelToggleResult> {
  return await chrome.sidePanel.browserosToggle({ tabId })
}

async function openWindowSidePanel({
  windowId,
}: SidePanelTarget): Promise<SidePanelToggleResult> {
  if (!openWindowSidePanelIds.has(windowId)) {
    await chrome.sidePanel.open({ windowId })
    await rememberWindowSidePanelOpen(windowId)
  }
  return { opened: true }
}

async function toggleWindowSidePanel(
  target: SidePanelTarget,
): Promise<SidePanelToggleResult> {
  if (openWindowSidePanelIds.has(target.windowId)) {
    await chrome.sidePanel.close({ windowId: target.windowId })
    await rememberWindowSidePanelClosed(target.windowId)
    return { opened: false }
  }
  return await openWindowSidePanel(target)
}

/** Tracks standard side panel events so window mode can behave like a toggle. */
export function registerSidePanelOpenStateListeners(): void {
  if (sidePanelOpenStateListenersRegistered) return
  sidePanelOpenStateListenersRegistered = true

  chrome.sidePanel.onOpened.addListener(async (info) => {
    if (info.tabId === undefined) {
      await rememberWindowSidePanelOpen(info.windowId)
    }
  })

  chrome.sidePanel.onClosed.addListener(async (info) => {
    if (info.tabId === undefined) {
      await rememberWindowSidePanelClosed(info.windowId)
    }
  })
}

/**
 * Opens from non-toolbar flows (agent/PI/search "show me this" triggers).
 * Must route through the same scope as the toolbar toggle: BrowserOS's
 * `sidePanel.open()` user-gesture check is disabled in this fork (see
 * packages/browseros/chromium_patches/.../side_panel_api.cc), so there is
 * no longer a reason for programmatic opens to bypass window scope — doing
 * so opened a second, tab-contextual panel instance underneath/instead of
 * the user's shared per-window panel, which looked like a random different
 * chat or the panel reopening on its own right after being closed.
 */
export async function openSidePanel(
  target: SidePanelTarget,
): Promise<SidePanelToggleResult> {
  await ensureSidePanelRuntimeStateLoaded()
  if (sidePanelPerWindow) {
    return await openWindowSidePanel(target)
  }
  return await openTabSidePanel(target)
}

/** Toggles the configured side panel scope from a toolbar/user gesture. */
export async function toggleSidePanel(
  target: SidePanelTarget,
): Promise<SidePanelToggleResult> {
  await ensureSidePanelRuntimeStateLoaded()
  if (sidePanelPerWindow) {
    return await toggleWindowSidePanel(target)
  }
  return await toggleTabSidePanel(target)
}
