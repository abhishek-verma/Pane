/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Background bridge: tab audio chunks, glow, browsing observer cadence.
 */

import {
  failMeetingSession,
  fetchActiveMeetingSessions,
  fetchCaptureConsents,
  observeBrowsingPage,
  recordResearchPage,
  startMeetingSession,
  stopMeetingSession,
} from '@/lib/capture/capture-api'
import { activateCaptureGlow, deactivateCaptureGlow } from '@/lib/capture/glow'
import {
  isMeetingRoomUrl,
  meetingHostname,
  meetingRoomLabel,
} from '@/lib/capture/meeting-urls'
import {
  researchModeStorage,
  researchThreadStorage,
} from '@/lib/capture/research-mode'
import {
  isRecording,
  recordingSessionIds,
  startTabAudioCapture,
  stopTabAudioCapture,
} from '@/lib/capture/tab-audio'
import {
  onRuntimeMessage,
  RuntimeMessageType,
} from '@/lib/messaging/runtime/runtimeMessages'

const SYNC_ALARM = 'capture-sync'
const SYNC_PERIOD_MINUTES = 0.25
const BROWSE_DEBOUNCE_MS = 30_000

const lastBrowseAtByTab = new Map<number, number>()
let syncing = false

function isSkippableUrl(url: string | undefined): boolean {
  if (!url) return true
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://')
  )
}

async function notifyCaptureError(message: string): Promise<void> {
  try {
    await chrome.notifications.create(`capture-err-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon/128.png'),
      title: 'Pane meeting capture',
      message,
    })
  } catch {
    // notifications permission may be unavailable in tests
  }
}

async function extractPageDigest(tabId: number): Promise<{
  title?: string
  text: string
} | null> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const title = document.title
      const text = document.body?.innerText?.slice(0, 8_000) ?? ''
      return { title, text }
    },
  })
  return result?.result ?? null
}

async function consentAllowed(
  url: string,
  captureClass: 'browsing' | 'research',
): Promise<boolean> {
  const host = meetingHostname(url)
  if (!host) return false
  const consents = await fetchCaptureConsents()
  return consents.some(
    (consent) =>
      consent.domain === host &&
      consent.class === captureClass &&
      consent.allowed,
  )
}

async function stopCaptureForSession(
  sessionId: string,
  tabId: number,
): Promise<void> {
  deactivateCaptureGlow(tabId, sessionId)
  await stopTabAudioCapture(sessionId).catch(() => null)
  await stopMeetingSession(sessionId).catch(() => null)
}

async function failCaptureForSession(
  sessionId: string,
  tabId: number,
  message: string,
): Promise<void> {
  deactivateCaptureGlow(tabId, sessionId)
  await stopTabAudioCapture(sessionId).catch(() => null)
  await failMeetingSession(sessionId, message).catch(() => null)
  await notifyCaptureError(message)
}

async function syncActiveSessions(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    const sessions = await fetchActiveMeetingSessions()
    const activeIds = new Set(sessions.map((session) => session.id))

    for (const session of sessions) {
      if (typeof session.tabId !== 'number') continue
      if (!session.url || !isMeetingRoomUrl(session.url)) {
        await stopCaptureForSession(session.id, session.tabId)
        continue
      }
      if (isRecording(session.id)) continue
      try {
        await startTabAudioCapture({
          sessionId: session.id,
          tabId: session.tabId,
        })
        activateCaptureGlow({
          tabId: session.tabId,
          sessionId: session.id,
          captureClass: 'meeting',
        })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Tab audio capture failed'
        await failCaptureForSession(session.id, session.tabId, message)
      }
    }

    for (const sessionId of recordingSessionIds()) {
      if (activeIds.has(sessionId)) continue
      const session = sessions.find((item) => item.id === sessionId)
      const tabId = session?.tabId
      await stopTabAudioCapture(sessionId)
      if (typeof tabId === 'number') {
        deactivateCaptureGlow(tabId, sessionId)
      }
    }
  } catch {
    // server may be offline during startup
  } finally {
    syncing = false
  }
}

async function maybeStartMeetingCapture(
  tabId: number,
  url: string,
): Promise<void> {
  if (isSkippableUrl(url) || !isMeetingRoomUrl(url)) return
  const host = meetingHostname(url)
  if (!host) return
  const consents = await fetchCaptureConsents()
  const allowed = consents.some(
    (consent) =>
      consent.domain === host && consent.class === 'meeting' && consent.allowed,
  )
  if (!allowed) return

  const active = await fetchActiveMeetingSessions()
  const existingOnTab = active.find((session) => session.tabId === tabId)
  if (existingOnTab?.url && isMeetingRoomUrl(existingOnTab.url)) return
  if (existingOnTab) {
    await stopCaptureForSession(existingOnTab.id, tabId)
  }

  const roomLabel = meetingRoomLabel(url)
  let sessionId: string | null = null
  try {
    const session = await startMeetingSession({
      tabId,
      url,
      title: roomLabel ?? undefined,
    })
    sessionId = session.id
    await startTabAudioCapture({ sessionId: session.id, tabId })
    activateCaptureGlow({
      tabId,
      sessionId: session.id,
      captureClass: 'meeting',
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Meeting capture failed to start'
    if (sessionId) {
      await failCaptureForSession(sessionId, tabId, message)
    } else {
      await notifyCaptureError(message)
    }
  }
}

async function stopCaptureForTab(tabId: number): Promise<void> {
  const active = await fetchActiveMeetingSessions()
  for (const session of active) {
    if (session.tabId === tabId) {
      await stopCaptureForSession(session.id, tabId)
    }
  }
}

async function handleNavigation(tabId: number, url: string): Promise<void> {
  if (isMeetingRoomUrl(url)) {
    await maybeStartMeetingCapture(tabId, url)
    return
  }
  await stopCaptureForTab(tabId)
  await observeTabIfConsented(tabId, url)
}

async function observeTabIfConsented(
  tabId: number,
  url: string,
): Promise<void> {
  if (isSkippableUrl(url)) return
  const now = Date.now()
  const last = lastBrowseAtByTab.get(tabId) ?? 0
  if (now - last < BROWSE_DEBOUNCE_MS) return
  lastBrowseAtByTab.set(tabId, now)

  const digest = await extractPageDigest(tabId)
  if (!digest?.text.trim()) return

  const researchMode = await researchModeStorage.getValue()
  if (researchMode && (await consentAllowed(url, 'research'))) {
    const threadId = await researchThreadStorage.getValue()
    await recordResearchPage({
      url,
      title: digest.title,
      text: digest.text,
      threadId: threadId ?? undefined,
      quote: digest.text.slice(0, 280),
    })
    return
  }

  if (await consentAllowed(url, 'browsing')) {
    await observeBrowsingPage({
      url,
      title: digest.title,
      text: digest.text,
    })
  }
}

export function captureBridge(): void {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) {
      void syncActiveSessions()
    }
  })

  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return
    void handleNavigation(details.tabId, details.url).catch(() => null)
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    lastBrowseAtByTab.delete(tabId)
    void stopCaptureForTab(tabId).catch(() => null)
  })

  onRuntimeMessage(RuntimeMessageType.stopCapture, async ({ data }) => {
    await stopTabAudioCapture(data.sessionId)
    await stopMeetingSession(data.sessionId).catch(() => null)
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (typeof tab.id === 'number') {
        deactivateCaptureGlow(tab.id, data.sessionId)
      }
    }
  })

  void syncActiveSessions()
}

export async function setResearchCaptureMode(enabled: boolean): Promise<void> {
  await researchModeStorage.setValue(enabled)
}

export async function getResearchCaptureMode(): Promise<boolean> {
  return researchModeStorage.getValue()
}
