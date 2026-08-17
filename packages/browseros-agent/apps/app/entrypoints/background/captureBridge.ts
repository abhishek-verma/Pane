/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Background bridge: tab audio chunks, glow, browsing observer cadence.
 */

import {
  GENERIC_UNKNOWN_START_MS,
  isMeetingConsentAllowed,
  type MeetingSiteAdapter,
  resolveCaptureAdapter,
} from '@browseros/capture/adapters'
import { decideCaptureLifecycle } from '@browseros/capture/meeting-lifecycle'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { browsingCaptureModeStorage } from '@/lib/capture/browsing-capture-mode'
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
  getMeetingTabCallState,
  getMeetingTabState,
} from '@/lib/capture/meeting-in-call'
import {
  isMeetingHost,
  isMeetingRoomUrl,
  meetingHostname,
  meetingRoomLabel,
} from '@/lib/capture/meeting-urls'
import {
  researchModeStorage,
  researchThreadStorage,
} from '@/lib/capture/research-mode'
import { stopSpeakerPoll } from '@/lib/capture/speaker-poll'
import {
  isRecording,
  recordingSessionIds,
  sessionIdsForTab,
  startTabAudioCapture,
  stopTabAudioCapture,
} from '@/lib/capture/tab-audio'
import {
  onRuntimeMessage,
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'

const SYNC_ALARM = 'capture-sync'
const SYNC_PERIOD_MINUTES = 0.25
/** Poll while pending join or actively recording (SPA leave/join detection). */
const PENDING_MEETING_POLL_MS = 4_000
const BROWSE_DEBOUNCE_MS = 30_000

const lastBrowseAtByTab = new Map<number, number>()
/** Room URLs waiting for in-call DOM before capture starts. */
const pendingMeetingTabs = new Map<number, string>()
/** First time we saw `unknown` for a generic allowlisted tab. */
const genericUnknownSince = new Map<number, number>()
/** Tabs that were in-call while we had an active capture (leave → stop). */
const captureWasInCallTabs = new Set<number>()
/** Consecutive `unknown` call-state ticks per tab while recording. */
const unknownStreakByTab = new Map<number, number>()
/** Last known mute state per session (to avoid redundant messages). */
const lastMuteBySession = new Map<string, boolean>()
let syncing = false
let pendingPollTimer: ReturnType<typeof setInterval> | null = null

function ensurePendingMeetingPoll(): void {
  if (pendingPollTimer) return
  pendingPollTimer = setInterval(() => {
    if (pendingMeetingTabs.size === 0 && recordingSessionIds().length === 0) {
      return
    }
    void pollPendingMeetingTabs().catch(() => null)
    // Faster leave detection than the 15s alarm — stop mic ASAP after hangup.
    if (recordingSessionIds().length > 0) {
      void syncActiveSessions().catch(() => null)
    }
  }, PENDING_MEETING_POLL_MS)
}

function stopPendingMeetingPollIfIdle(): void {
  if (pendingMeetingTabs.size > 0 || recordingSessionIds().length > 0) return
  if (!pendingPollTimer) return
  clearInterval(pendingPollTimer)
  pendingPollTimer = null
}

async function tabStillOpen(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId)
    return true
  } catch {
    return false
  }
}

function isSkippableUrl(url: string | undefined): boolean {
  if (!url) return true
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('devtools://')
  )
}

async function meetingAllowedHosts(): Promise<string[]> {
  const consents = await fetchCaptureConsents()
  return consents
    .filter((c) => c.class === 'meeting' && c.allowed)
    .map((c) => c.domain)
}

async function resolveMeetingAdapter(
  url: string,
): Promise<MeetingSiteAdapter | null> {
  const allowed = await meetingAllowedHosts()
  return resolveCaptureAdapter(url, allowed)
}

async function isCapturableMeetingUrl(url: string): Promise<boolean> {
  const adapter = await resolveMeetingAdapter(url)
  if (!adapter) return false
  return adapter.detectRoom(url) !== null
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

async function _consentAllowed(
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

async function isDomainDenied(url: string): Promise<boolean> {
  try {
    const serverUrl = (await getAgentServerUrl()).replace(/\/$/, '')
    const res = await agentFetch(`${serverUrl}/context/grants?deniedOnly=true`)
    if (!res.ok) return false
    const json = (await res.json()) as {
      grants: Array<{ domain: string; allowed: boolean }>
    }
    const host = new URL(url).hostname.toLowerCase()
    return json.grants.some(
      (g) => !g.allowed && (host === g.domain || host.endsWith(`.${g.domain}`)),
    )
  } catch {
    return false
  }
}

async function stopCaptureForSession(
  sessionId: string,
  tabId: number,
): Promise<void> {
  stopSpeakerPoll(sessionId)
  captureWasInCallTabs.delete(tabId)
  unknownStreakByTab.delete(tabId)
  lastMuteBySession.delete(sessionId)
  deactivateCaptureGlow(tabId, sessionId)
  await stopTabAudioCapture(sessionId).catch(() => null)
  await stopMeetingSession(sessionId).catch(() => null)
  await chrome.storage.session
    .remove(`captureSession:${tabId}`)
    .catch(() => null)
  stopPendingMeetingPollIfIdle()
  void sendRuntimeMessage(RuntimeMessageType.captureSessionStopped, {
    sessionId,
  }).catch(() => null)
}

async function failCaptureForSession(
  sessionId: string,
  tabId: number,
  message: string,
): Promise<void> {
  stopSpeakerPoll(sessionId)
  captureWasInCallTabs.delete(tabId)
  unknownStreakByTab.delete(tabId)
  lastMuteBySession.delete(sessionId)
  deactivateCaptureGlow(tabId, sessionId)
  await stopTabAudioCapture(sessionId).catch(() => null)
  await failMeetingSession(sessionId, message).catch(() => null)
  await notifyCaptureError(message)
}

/** Offscreen tabCapture + mic mix (standard Chrome meeting-capture pattern). */
async function startCaptureAudio(
  sessionId: string,
  tabId: number,
): Promise<void> {
  await startTabAudioCapture({ sessionId, tabId })
  // Do not mark wasInCall here — only sync's `in-call` decision should.
  // Generic auto-start on unknown+audible must not look like a hangup later.
  unknownStreakByTab.delete(tabId)
  ensurePendingMeetingPoll()
}

/**
 * Generic sites: allow start on `in-call`, or `unknown` held > N ms while tab audible.
 * Mature sites: strict `in-call` only — EXCEPT when the tab has been audible and
 * on a room URL for longer than GENERIC_UNKNOWN_START_MS (last-resort fallback for
 * icon-only UIs or future Zoom clients where the DOM probe returns nothing useful).
 */
async function shouldStartCaptureForState(
  _adapter: MeetingSiteAdapter,
  tabId: number,
  callState: Awaited<ReturnType<typeof getMeetingTabCallState>>,
): Promise<boolean> {
  if (callState === 'in-call') {
    genericUnknownSince.delete(tabId)
    return true
  }
  if (callState !== 'unknown') {
    genericUnknownSince.delete(tabId)
    return false
  }
  // `unknown` path: generic always eligible; mature eligible after audibility hold.
  const since = genericUnknownSince.get(tabId) ?? Date.now()
  if (!genericUnknownSince.has(tabId)) {
    genericUnknownSince.set(tabId, since)
  }
  if (Date.now() - since < GENERIC_UNKNOWN_START_MS) return false
  try {
    const tab = await chrome.tabs.get(tabId)
    return Boolean(tab.audible)
  } catch {
    return false
  }
}

async function syncActiveSessions(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    await pollPendingMeetingTabs()

    const sessions = await fetchActiveMeetingSessions()
    const activeIds = new Set(sessions.map((session) => session.id))

    for (const session of sessions) {
      if (typeof session.tabId !== 'number') continue
      const tabId = session.tabId
      const adapter = session.url
        ? await resolveMeetingAdapter(session.url)
        : null

      // Interrupted/paused leftovers: hard-stop any local recorder.
      if (session.status === 'interrupted' || session.status === 'paused') {
        if (isRecording(session.id)) {
          await stopCaptureForSession(session.id, tabId)
        } else {
          stopSpeakerPoll(session.id)
          deactivateCaptureGlow(tabId, session.id)
          captureWasInCallTabs.delete(tabId)
          unknownStreakByTab.delete(tabId)
        }
        continue
      }

      const capturable = session.url
        ? await isCapturableMeetingUrl(session.url)
        : false
      if (
        !session.url ||
        (!capturable &&
          !isMeetingRoomUrl(session.url) &&
          session.site !== 'generic')
      ) {
        await stopCaptureForSession(session.id, tabId)
        continue
      }

      const tabOpen = await tabStillOpen(tabId)
      const { callState, localMuted } = tabOpen
        ? await getMeetingTabState(tabId).catch(() => ({
            callState: 'unknown' as const,
            localMuted: null as boolean | null,
          }))
        : { callState: 'unknown' as const, localMuted: null as boolean | null }

      // Forward mute state to offscreen recorder (pause/resume mic)
      if (
        isRecording(session.id) &&
        localMuted !== null &&
        localMuted !== lastMuteBySession.get(session.id)
      ) {
        lastMuteBySession.set(session.id, localMuted)
        sendRuntimeMessage(RuntimeMessageType.captureMicMute, {
          sessionId: session.id,
          muted: localMuted,
        }).catch(() => {
          lastMuteBySession.delete(session.id)
        })
      }

      const decision = decideCaptureLifecycle({
        callState,
        isRecording: isRecording(session.id),
        wasInCall: captureWasInCallTabs.has(tabId),
        tabOpen,
        unknownStreak: unknownStreakByTab.get(tabId) ?? 0,
        maturity: adapter?.maturity ?? 'mature',
      })

      unknownStreakByTab.set(tabId, decision.nextUnknownStreak)
      if (decision.markInCall) captureWasInCallTabs.add(tabId)
      if (decision.clearInCall) captureWasInCallTabs.delete(tabId)

      if (decision.action === 'stop') {
        pendingMeetingTabs.delete(tabId)
        genericUnknownSince.delete(tabId)
        await stopCaptureForSession(session.id, tabId)
        continue
      }

      if (decision.action === 'wait') {
        pendingMeetingTabs.set(tabId, session.url)
        ensurePendingMeetingPoll()
        if (!isRecording(session.id)) {
          deactivateCaptureGlow(tabId, session.id)
        }
        continue
      }

      // start | keep
      pendingMeetingTabs.delete(tabId)
      ensurePendingMeetingPoll()
      if (decision.action === 'keep' && isRecording(session.id)) {
        activateCaptureGlow({
          tabId,
          sessionId: session.id,
          captureClass: 'meeting',
        })
        continue
      }
      try {
        await startCaptureAudio(session.id, tabId)
        activateCaptureGlow({
          tabId,
          sessionId: session.id,
          captureClass: 'meeting',
        })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Tab audio capture failed'
        await failCaptureForSession(session.id, tabId, message)
      }
    }

    // Orphan local recorders (server session already gone).
    for (const sessionId of recordingSessionIds()) {
      if (activeIds.has(sessionId)) continue
      stopSpeakerPoll(sessionId)
      const session = sessions.find((item) => item.id === sessionId)
      const tabId = session?.tabId
      await stopTabAudioCapture(sessionId)
      lastMuteBySession.delete(sessionId)
      if (typeof tabId === 'number') {
        deactivateCaptureGlow(tabId, sessionId)
        captureWasInCallTabs.delete(tabId)
        unknownStreakByTab.delete(tabId)
      }
    }
  } catch {
    // server may be offline during startup
  } finally {
    syncing = false
  }
}

async function pollPendingMeetingTabs(): Promise<void> {
  for (const [tabId, url] of pendingMeetingTabs.entries()) {
    const adapter = await resolveMeetingAdapter(url)
    // A consented mature adapter with no room key (e.g. Teams Free at /v2/)
    // is still capturable — skip the detectRoom gate and rely on call-state.
    if (!adapter) {
      pendingMeetingTabs.delete(tabId)
      continue
    }
    if (!adapter.detectRoom(url) && adapter.maturity !== 'mature') {
      pendingMeetingTabs.delete(tabId)
      continue
    }
    const callState = await getMeetingTabCallState(tabId).catch(
      () => 'prejoin' as const,
    )
    const ready = await shouldStartCaptureForState(adapter, tabId, callState)
    if (!ready) continue
    pendingMeetingTabs.delete(tabId)
    await maybeStartMeetingCapture(tabId, url)
  }
  stopPendingMeetingPollIfIdle()
}

async function maybeStartMeetingCapture(
  tabId: number,
  url: string,
): Promise<void> {
  if (isSkippableUrl(url)) return
  const adapter = await resolveMeetingAdapter(url)
  // Allow mature adapters through even without a room key (e.g. Teams Free
  // at /v2/ where the SPA never surfaces a room ID in the URL).
  if (!adapter || (!adapter.detectRoom(url) && adapter.maturity !== 'mature'))
    return

  const host = meetingHostname(url)
  if (!host) return
  const allowedHosts = await meetingAllowedHosts()
  if (!isMeetingConsentAllowed(host, allowedHosts)) return

  const callState = await getMeetingTabCallState(tabId).catch(
    () => 'prejoin' as const,
  )
  if (callState === 'left') {
    pendingMeetingTabs.delete(tabId)
    genericUnknownSince.delete(tabId)
    await stopCaptureForTab(tabId)
    return
  }
  const ready = await shouldStartCaptureForState(adapter, tabId, callState)
  if (!ready) {
    pendingMeetingTabs.set(tabId, url)
    ensurePendingMeetingPoll()
    return
  }
  // Mark before audio starts so a fast hangup cannot race past wasInCall.
  if (callState === 'in-call') {
    captureWasInCallTabs.add(tabId)
  }
  pendingMeetingTabs.delete(tabId)
  genericUnknownSince.delete(tabId)

  const active = await fetchActiveMeetingSessions()
  const existingOnTab = active.find((session) => session.tabId === tabId)
  if (existingOnTab?.url) {
    const existingCapturable = await isCapturableMeetingUrl(existingOnTab.url)
    if (existingCapturable || isMeetingRoomUrl(existingOnTab.url)) {
      if (!isRecording(existingOnTab.id)) {
        try {
          await startCaptureAudio(existingOnTab.id, tabId)
          activateCaptureGlow({
            tabId,
            sessionId: existingOnTab.id,
            captureClass: 'meeting',
          })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Tab audio capture failed'
          await failCaptureForSession(existingOnTab.id, tabId, message)
        }
      }
      return
    }
  }
  if (existingOnTab) {
    await stopCaptureForSession(existingOnTab.id, tabId)
  }

  const sticky = await chrome.storage.session
    .get(`captureSession:${tabId}`)
    .catch(() => ({}) as Record<string, string>)
  const stickySessionId = sticky[`captureSession:${tabId}`]
  const resumeSessionId =
    typeof stickySessionId === 'string' ? stickySessionId : undefined

  const roomLabel = meetingRoomLabel(url)
  let sessionId: string | null = null
  try {
    const session = await startMeetingSession({
      tabId,
      url,
      resumeSessionId,
      title: roomLabel ?? undefined,
    })
    sessionId = session.id
    await chrome.storage.session
      .set({ [`captureSession:${tabId}`]: session.id })
      .catch(() => null)
    await startCaptureAudio(session.id, tabId)
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
  // Local recorder map is the source of truth for stopping mic/ASR — do this
  // even if the server fetch fails or tabId on the session row is stale.
  const localIds = sessionIdsForTab(tabId)
  for (const sessionId of localIds) {
    await stopCaptureForSession(sessionId, tabId)
  }
  const active = await fetchActiveMeetingSessions().catch(() => [])
  for (const session of active) {
    if (session.tabId === tabId && !localIds.includes(session.id)) {
      await stopCaptureForSession(session.id, tabId)
    }
  }
  captureWasInCallTabs.delete(tabId)
  unknownStreakByTab.delete(tabId)
  genericUnknownSince.delete(tabId)
}

async function handleNavigation(tabId: number, url: string): Promise<void> {
  // Best-effort Personalised Internet harvest wake (server gates on harvestEnabled).
  const { notifyPiHostOpened } = await import('./piHostOpened')
  notifyPiHostOpened(url)

  if (await isCapturableMeetingUrl(url)) {
    // Navigation (including refresh) kills the tab's MediaStream. If we were
    // recording on this tab, stop the dead audio capture so it can be restarted
    // with a fresh stream once the page renders its in-call DOM.
    const staleIds = sessionIdsForTab(tabId)
    for (const sessionId of staleIds) {
      stopSpeakerPoll(sessionId)
      deactivateCaptureGlow(tabId, sessionId)
      await stopTabAudioCapture(sessionId).catch(() => null)
      lastMuteBySession.delete(sessionId)
    }
    captureWasInCallTabs.delete(tabId)
    unknownStreakByTab.delete(tabId)
    pendingMeetingTabs.set(tabId, url)
    ensurePendingMeetingPoll()
    await maybeStartMeetingCapture(tabId, url)
    return
  }
  // Mature room URL without consent yet — still track if URL looks like a room
  if (isMeetingRoomUrl(url)) {
    pendingMeetingTabs.set(tabId, url)
    ensurePendingMeetingPoll()
    await maybeStartMeetingCapture(tabId, url)
    return
  }
  // Consented mature meeting host with no room ID in the URL (e.g. Teams Free
  // at /v2/ where the active-call SPA never surfaces the room in the path).
  // Track the tab so the pending poll can detect in-call DOM signals.
  if (isMeetingHost(url)) {
    const host = meetingHostname(url)
    const allowedHosts = await meetingAllowedHosts()
    if (host && isMeetingConsentAllowed(host, allowedHosts)) {
      pendingMeetingTabs.set(tabId, url)
      ensurePendingMeetingPoll()
      await maybeStartMeetingCapture(tabId, url)
      return
    }
  }
  pendingMeetingTabs.delete(tabId)
  genericUnknownSince.delete(tabId)
  stopPendingMeetingPollIfIdle()
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

  const denied = await isDomainDenied(url)
  if (denied) return

  const researchMode = await researchModeStorage.getValue()
  if (researchMode) {
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

  const browsingMode = await browsingCaptureModeStorage.getValue()
  if (browsingMode) {
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

  onRuntimeMessage(RuntimeMessageType.getCaptureServerUrl, async () => {
    try {
      return { serverUrl: await getAgentServerUrl() }
    } catch (err: unknown) {
      return {
        error: err instanceof Error ? err.message : String(err),
      }
    }
  })

  chrome.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0) return
    void handleNavigation(details.tabId, details.url).catch(() => null)
  })

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' && !changeInfo.url) return
    const url = changeInfo.url ?? tab.url
    if (!url) return
    void (async () => {
      const isCapturableRoom = await isCapturableMeetingUrl(url)
      const isKnownRoom = isMeetingRoomUrl(url)
      // Also handle consented mature-adapter hosts with no room ID in the URL
      // (e.g. Teams Free at /v2/). Reuse the same consent check as handleNavigation.
      const isConsentedMatureHost = async () => {
        if (!isMeetingHost(url)) return false
        const host = meetingHostname(url)
        const allowedHosts = await meetingAllowedHosts()
        return !!(host && isMeetingConsentAllowed(host, allowedHosts))
      }
      if (
        !isCapturableRoom &&
        !isKnownRoom &&
        !(await isConsentedMatureHost())
      ) {
        return
      }
      pendingMeetingTabs.set(tabId, url)
      ensurePendingMeetingPoll()
      await maybeStartMeetingCapture(tabId, url)
    })().catch(() => null)
  })

  chrome.tabs.onRemoved.addListener((tabId) => {
    lastBrowseAtByTab.delete(tabId)
    pendingMeetingTabs.delete(tabId)
    genericUnknownSince.delete(tabId)
    // Hard stop first — stopCaptureForTab clears wasInCall / streaks.
    // Do not clear those maps before stop finishes (avoids zombie sessions
    // if a concurrent sync tick races the close).
    void stopCaptureForTab(tabId)
      .catch(() => null)
      .finally(() => {
        stopPendingMeetingPollIfIdle()
      })
  })

  onRuntimeMessage(RuntimeMessageType.stopCapture, async ({ data }) => {
    stopSpeakerPoll(data.sessionId)
    await stopTabAudioCapture(data.sessionId)
    await stopMeetingSession(data.sessionId).catch(() => null)
    lastMuteBySession.delete(data.sessionId)
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

export async function setBrowsingCaptureMode(enabled: boolean): Promise<void> {
  await browsingCaptureModeStorage.setValue(enabled)
}

export async function getBrowsingCaptureMode(): Promise<boolean> {
  return browsingCaptureModeStorage.getValue()
}
