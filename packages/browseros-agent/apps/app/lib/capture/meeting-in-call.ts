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
    // Run in all frames so we capture controls inside meeting iframes
    // (e.g. Zoom PWA renders its WebRTC UI in a child frame on app.zoom.us).
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: collectMeetingDomFactsPage,
    })
    if (!results?.length) return null

    // Use the main-frame result as the base for hostname / bodyText / href.
    const main = results[0]?.result
    if (!main?.hostname || !main.facts) return null

    // Merge facts from all frames: OR the boolean signals, union the arrays.
    // Child frames that fail to execute return null — skip them gracefully.
    let merged = main.facts
    for (let i = 1; i < results.length; i++) {
      const frame = results[i]?.result
      if (!frame?.facts) continue
      merged = {
        matchedSelectors: [
          ...new Set([
            ...merged.matchedSelectors,
            ...frame.facts.matchedSelectors,
          ]),
        ],
        ariaLabels: [...merged.ariaLabels, ...frame.facts.ariaLabels].slice(
          0,
          120,
        ),
        speakingCandidates: [
          ...merged.speakingCandidates,
          ...frame.facts.speakingCandidates,
        ].slice(0, 30),
        captionRows: [
          ...(merged.captionRows ?? []),
          ...(frame.facts.captionRows ?? []),
        ].slice(-8),
        attendees: [
          ...(merged.attendees ?? []),
          ...(frame.facts.attendees ?? []),
        ].slice(0, 40),
        selfName: merged.selfName ?? frame.facts.selfName,
        hasVisibleLeaveControl:
          merged.hasVisibleLeaveControl || frame.facts.hasVisibleLeaveControl,
        hasVisibleJoinControl:
          merged.hasVisibleJoinControl || frame.facts.hasVisibleJoinControl,
        hasVisibleMuteControl:
          merged.hasVisibleMuteControl || frame.facts.hasVisibleMuteControl,
      }
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
