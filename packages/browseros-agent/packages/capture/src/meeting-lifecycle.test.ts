/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  decideCaptureLifecycle,
  UNKNOWN_STOP_STREAK,
  UNKNOWN_STOP_STREAK_MATURE,
} from './meeting-lifecycle'

describe('decideCaptureLifecycle', () => {
  it('starts on in-call when not recording', () => {
    const d = decideCaptureLifecycle({
      callState: 'in-call',
      isRecording: false,
      wasInCall: false,
      tabOpen: true,
      unknownStreak: 0,
      maturity: 'mature',
    })
    expect(d.action).toBe('start')
    expect(d.markInCall).toBe(true)
  })

  it('keeps recording while in-call', () => {
    const d = decideCaptureLifecycle({
      callState: 'in-call',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: 2,
      maturity: 'mature',
    })
    expect(d.action).toBe('keep')
    expect(d.nextUnknownStreak).toBe(0)
  })

  it('stops on left after recording', () => {
    const d = decideCaptureLifecycle({
      callState: 'left',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: 0,
      maturity: 'mature',
    })
    expect(d.action).toBe('stop')
    expect(d.reason).toBe('call_left')
    expect(d.clearInCall).toBe(true)
  })

  it('stops on prejoin after was in-call (Meet post-hangup lobby)', () => {
    // First prejoin tick gets grace for mature adapters (modal dialogs)
    const d1 = decideCaptureLifecycle({
      callState: 'prejoin',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: 0,
      maturity: 'mature',
    })
    expect(d1.action).toBe('keep')
    expect(d1.reason).toBe('prejoin_grace')
    expect(d1.nextUnknownStreak).toBe(1)

    // Second consecutive prejoin tick → stop
    const d2 = decideCaptureLifecycle({
      callState: 'prejoin',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: d1.nextUnknownStreak,
      maturity: 'mature',
    })
    expect(d2.action).toBe('stop')
    expect(d2.reason).toBe('left_to_lobby')
  })

  it('stops immediately on prejoin after was in-call for generic adapters', () => {
    const d = decideCaptureLifecycle({
      callState: 'prejoin',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: 0,
      maturity: 'generic',
    })
    expect(d.action).toBe('stop')
    expect(d.reason).toBe('left_to_lobby')
  })

  it('does not stop on prejoin before wasInCall is marked', () => {
    const d = decideCaptureLifecycle({
      callState: 'prejoin',
      isRecording: true,
      wasInCall: false,
      tabOpen: true,
      unknownStreak: 0,
      maturity: 'mature',
    })
    expect(d.action).toBe('wait')
  })

  it('keeps generic recordings on unknown (no streak stop)', () => {
    const d = decideCaptureLifecycle({
      callState: 'unknown',
      isRecording: true,
      wasInCall: false,
      tabOpen: true,
      unknownStreak: 5,
      maturity: 'generic',
    })
    expect(d.action).toBe('keep')
    expect(d.reason).toBe('generic_unknown_keep')
  })

  it('stops when tab closes even without local recorder flag', () => {
    const d = decideCaptureLifecycle({
      callState: 'in-call',
      isRecording: false,
      wasInCall: false,
      tabOpen: false,
      unknownStreak: 0,
      maturity: 'mature',
    })
    expect(d.action).toBe('stop')
    expect(d.reason).toBe('tab_closed')
  })

  it('waits on prejoin before ever joining', () => {
    const d = decideCaptureLifecycle({
      callState: 'prejoin',
      isRecording: false,
      wasInCall: false,
      tabOpen: true,
      unknownStreak: 0,
      maturity: 'mature',
    })
    expect(d.action).toBe('wait')
  })

  it('keeps briefly on unknown then stops after streak (generic threshold)', () => {
    const grace = decideCaptureLifecycle({
      callState: 'unknown',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: 0,
      maturity: 'mature',
    })
    expect(grace.action).toBe('keep')
    expect(grace.nextUnknownStreak).toBe(1)

    // mature threshold is UNKNOWN_STOP_STREAK_MATURE, not UNKNOWN_STOP_STREAK
    const stop = decideCaptureLifecycle({
      callState: 'unknown',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: UNKNOWN_STOP_STREAK_MATURE - 1,
      maturity: 'mature',
    })
    expect(stop.action).toBe('stop')
    expect(stop.reason).toBe('unknown_streak')
  })

  it('mature adapters get longer unknown grace than generic stop threshold', () => {
    // Still keeping at the old generic streak threshold
    const stillKeeping = decideCaptureLifecycle({
      callState: 'unknown',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: UNKNOWN_STOP_STREAK,
      maturity: 'mature',
    })
    expect(stillKeeping.action).toBe('keep')

    // Stops only at the mature threshold
    const stop = decideCaptureLifecycle({
      callState: 'unknown',
      isRecording: true,
      wasInCall: true,
      tabOpen: true,
      unknownStreak: UNKNOWN_STOP_STREAK_MATURE - 1,
      maturity: 'mature',
    })
    expect(stop.action).toBe('stop')
    expect(stop.reason).toBe('unknown_streak')
  })
})
