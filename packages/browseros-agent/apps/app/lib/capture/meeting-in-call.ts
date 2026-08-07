/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  type ActiveSpeakerObservation,
  collectMeetingDomFactsPage,
  genericAdapter,
  getAdapterForHost,
  type MeetingDomProbe,
} from '@browseros/capture/adapters'
import type { MeetingCallState } from '@browseros/capture/meeting-in-call'

export type { ActiveSpeakerObservation, MeetingCallState, MeetingDomProbe }

async function collectTabDomProbe(
  tabId: number,
): Promise<MeetingDomProbe | null> {
  try {
    // Start with the main frame (always works, never hangs).
    const [mainResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectMeetingDomFactsPage,
    })
    const main = mainResult?.result
    if (!main?.hostname || !main.facts) return null

    // If the main frame already has call controls, use it directly.
    if (main.facts.hasVisibleMuteControl || main.facts.hasVisibleLeaveControl) {
      return {
        hostname: main.hostname,
        href: main.href ?? '',
        bodyText: main.bodyText ?? '',
        pageTitle: main.pageTitle ?? '',
        facts: main.facts,
      }
    }

    // Main frame doesn't have controls (e.g. Zoom PWA wraps meeting in a child
    // frame). Probe same-origin child frames individually. We avoid allFrames:true
    // because it hangs indefinitely when blob:/about:blank frames exist.
    let merged = main.facts
    try {
      const frames = await Promise.race([
        chrome.webNavigation.getAllFrames({ tabId }),
        new Promise<null>((r) => setTimeout(() => r(null), 3000)),
      ])
      if (frames) {
        const childFrames = frames.filter(
          (f) =>
            f.frameId !== 0 &&
            f.url.startsWith('http') &&
            !f.url.startsWith('about:'),
        )
        for (const frame of childFrames.slice(0, 6)) {
          try {
            const [result] = await Promise.race([
              chrome.scripting.executeScript({
                target: { tabId, frameIds: [frame.frameId] },
                func: collectMeetingDomFactsPage,
              }),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('frame timeout')), 2000),
              ),
            ])
            const frameFacts = result?.result?.facts
            if (!frameFacts) continue
            merged = {
              matchedSelectors: [
                ...new Set([
                  ...merged.matchedSelectors,
                  ...frameFacts.matchedSelectors,
                ]),
              ],
              ariaLabels: [
                ...merged.ariaLabels,
                ...frameFacts.ariaLabels,
              ].slice(0, 120),
              speakingCandidates: [
                ...merged.speakingCandidates,
                ...frameFacts.speakingCandidates,
              ].slice(0, 30),
              captionRows: [
                ...(merged.captionRows ?? []),
                ...(frameFacts.captionRows ?? []),
              ].slice(-8),
              attendees: [
                ...(merged.attendees ?? []),
                ...(frameFacts.attendees ?? []),
              ].slice(0, 40),
              selfName: merged.selfName ?? frameFacts.selfName,
              hasVisibleLeaveControl:
                merged.hasVisibleLeaveControl ||
                frameFacts.hasVisibleLeaveControl,
              hasVisibleJoinControl:
                merged.hasVisibleJoinControl ||
                frameFacts.hasVisibleJoinControl,
              hasVisibleMuteControl:
                merged.hasVisibleMuteControl ||
                frameFacts.hasVisibleMuteControl,
            }
            if (merged.hasVisibleMuteControl || merged.hasVisibleLeaveControl) {
              break
            }
          } catch {}
        }
      }
    } catch {
      // webNavigation.getAllFrames failed — proceed with main frame only
    }

    return {
      hostname: main.hostname,
      href: main.href ?? '',
      bodyText: main.bodyText ?? '',
      pageTitle: main.pageTitle ?? '',
      facts: merged,
    }
  } catch {
    return null
  }
}

/** Ask the meeting tab for pre-join / in-call / left state. */
export async function getMeetingTabCallState(
  tabId: number,
): Promise<MeetingCallState> {
  const probe = await collectTabDomProbe(tabId)
  if (!probe) return 'unknown'
  const adapter = getAdapterForHost(probe.hostname) ?? genericAdapter
  return adapter.evaluateCallState(probe)
}

/** Returns both call state and local mute state from a single probe. */
export async function getMeetingTabState(tabId: number): Promise<{
  callState: MeetingCallState
  localMuted: boolean | null
}> {
  const probe = await collectTabDomProbe(tabId)
  if (!probe) return { callState: 'unknown', localMuted: null }
  const adapter = getAdapterForHost(probe.hostname) ?? genericAdapter
  const callState = adapter.evaluateCallState(probe)
  const localMuted = adapter.probeLocalMute?.(probe) ?? null
  return { callState, localMuted }
}

export async function isMeetingTabInCall(tabId: number): Promise<boolean> {
  return (await getMeetingTabCallState(tabId)) === 'in-call'
}

/** Collect DOM probe + active speaker for adapters with speakerLabels. */
export async function getMeetingTabActiveSpeaker(tabId: number): Promise<{
  probe: MeetingDomProbe
  observation: ActiveSpeakerObservation | null
  adapterId: string
} | null> {
  const probe = await collectTabDomProbe(tabId)
  if (!probe) return null
  const adapter = getAdapterForHost(probe.hostname) ?? genericAdapter
  const observation = adapter.probeActiveSpeaker?.(probe) ?? null
  return { probe, observation, adapterId: adapter.id }
}

export async function getMeetingTabParticipants(
  tabId: number,
): Promise<Array<{ displayName: string; isLocalSelf?: boolean }>> {
  const probe = await collectTabDomProbe(tabId)
  if (!probe) return []
  const adapter = getAdapterForHost(probe.hostname) ?? genericAdapter
  return adapter.probeParticipants?.(probe) ?? []
}
