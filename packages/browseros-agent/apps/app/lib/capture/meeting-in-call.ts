/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import {
  type MeetingCallState,
  probeMeetingCallStatePage,
} from '@browseros/capture/meeting-in-call'

export type { MeetingCallState }

/** Ask the meeting tab for pre-join / in-call / left state. */
export async function getMeetingTabCallState(
  tabId: number,
): Promise<MeetingCallState> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: probeMeetingCallStatePage,
  })
  const value = result?.result
  if (value === 'prejoin' || value === 'in-call' || value === 'left') {
    return value
  }
  return 'prejoin'
}

export async function isMeetingTabInCall(tabId: number): Promise<boolean> {
  return (await getMeetingTabCallState(tabId)) === 'in-call'
}
