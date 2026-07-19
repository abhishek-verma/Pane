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
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectMeetingDomFactsPage,
    })
    const page = result?.result
    if (!page?.hostname || !page.facts) return null
    return {
      hostname: page.hostname,
      href: page.href ?? '',
      bodyText: page.bodyText ?? '',
      pageTitle: page.pageTitle ?? '',
      facts: page.facts,
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
