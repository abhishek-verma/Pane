/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pure start/stop decisions for meeting capture.
 * Keep this free of Chrome APIs so it stays unit-testable.
 */

import type { MeetingCallState } from './types'

/**
 * Consecutive `unknown` probes while recording before we hard-stop.
 * At a ~4s poll this is ~8s of grace for flaky DOM.
 * Mature adapters (Zoom, Meet, Teams) need more: their SPAs can temporarily
 * return `unknown` during in-call UI redraws, participant joins, etc.
 */
export const UNKNOWN_STOP_STREAK = 2
export const UNKNOWN_STOP_STREAK_MATURE = 5

/**
 * Consecutive `prejoin` probes while recording (mature only) before stop.
 * Modal overlays (invite dialog, settings) can momentarily inject pre-join
 * keywords into bodyText. At ~4s poll this gives ~8s tolerance.
 */
export const PREJOIN_STOP_STREAK_MATURE = 2

export type CaptureLifecycleAction = 'start' | 'keep' | 'stop' | 'wait'

export interface CaptureLifecycleInput {
  callState: MeetingCallState
  isRecording: boolean
  /** True after we have observed `in-call` for this tab/session. */
  wasInCall: boolean
  tabOpen: boolean
  /** How many consecutive sync ticks saw `unknown` while recording. */
  unknownStreak: number
  maturity: 'mature' | 'generic'
}

export interface CaptureLifecycleDecision {
  action: CaptureLifecycleAction
  reason: string
  nextUnknownStreak: number
  /** Mark wasInCall=true when we confirm in-call. */
  markInCall: boolean
  /** Clear wasInCall when the meeting has ended. */
  clearInCall: boolean
}

/**
 * Decide whether to start, keep, stop, or wait for meeting capture.
 *
 * End rules (hard stop — never keep mic/ASR running):
 * - tab closed
 * - call state `left`
 * - call state `prejoin` after we were in-call / already recording
 * - `unknown` while recording for UNKNOWN_STOP_STREAK consecutive ticks
 *
 * Start rules:
 * - mature: only `in-call`
 * - generic: `in-call` (unknown→start is handled by the bridge via audible hold)
 */
export function decideCaptureLifecycle(
  input: CaptureLifecycleInput,
): CaptureLifecycleDecision {
  // Active sessions with a missing tab must always stop (avoid zombie rows).
  if (!input.tabOpen) {
    return {
      action: 'stop',
      reason: 'tab_closed',
      nextUnknownStreak: 0,
      markInCall: false,
      clearInCall: true,
    }
  }

  if (input.callState === 'left') {
    return {
      action: input.isRecording || input.wasInCall ? 'stop' : 'wait',
      reason: 'call_left',
      nextUnknownStreak: 0,
      markInCall: false,
      clearInCall: true,
    }
  }

  if (input.callState === 'in-call') {
    return {
      action: input.isRecording ? 'keep' : 'start',
      reason: input.isRecording ? 'still_in_call' : 'entered_in_call',
      nextUnknownStreak: 0,
      markInCall: true,
      clearInCall: false,
    }
  }

  // Lobby after a confirmed in-call — hangup without a `left` phrase.
  // Require wasInCall so a prejoin flicker before the first in-call mark
  // does not kill a brand-new recorder.
  // Mature adapters tolerate brief prejoin (modal dialogs can inject pre-join
  // keywords) — stop only after PREJOIN_STOP_STREAK_MATURE consecutive ticks.
  if (input.callState === 'prejoin' && input.wasInCall) {
    if (input.maturity === 'mature' && input.isRecording) {
      const next = input.unknownStreak + 1
      if (next < PREJOIN_STOP_STREAK_MATURE) {
        return {
          action: 'keep',
          reason: 'prejoin_grace',
          nextUnknownStreak: next,
          markInCall: false,
          clearInCall: false,
        }
      }
    }
    return {
      action: 'stop',
      reason: 'left_to_lobby',
      nextUnknownStreak: 0,
      markInCall: false,
      clearInCall: true,
    }
  }

  if (input.callState === 'unknown' && input.isRecording) {
    // Generic sites often stay on `unknown` for the whole call — keep them.
    if (input.maturity === 'generic') {
      return {
        action: 'keep',
        reason: 'generic_unknown_keep',
        nextUnknownStreak: 0,
        markInCall: false,
        clearInCall: false,
      }
    }
    const stopAt =
      input.maturity === 'mature'
        ? UNKNOWN_STOP_STREAK_MATURE
        : UNKNOWN_STOP_STREAK
    const next = input.unknownStreak + 1
    if (next >= stopAt) {
      return {
        action: 'stop',
        reason: 'unknown_streak',
        nextUnknownStreak: 0,
        markInCall: false,
        clearInCall: true,
      }
    }
    return {
      action: 'keep',
      reason: 'unknown_grace',
      nextUnknownStreak: next,
      markInCall: false,
      clearInCall: false,
    }
  }

  return {
    action: 'wait',
    reason:
      input.callState === 'unknown' ? 'unknown_not_recording' : 'prejoin_wait',
    nextUnknownStreak: 0,
    markInCall: false,
    clearInCall: false,
  }
}
