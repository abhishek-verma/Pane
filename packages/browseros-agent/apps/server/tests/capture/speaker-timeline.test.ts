/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, describe, expect, it } from 'bun:test'
import {
  applyMicSelfBoost,
  clearSpeakerTimeline,
  recordSpeakerObservation,
  resolveSpeakerAt,
  setSessionParticipants,
} from '../../src/capture/speaker-timeline'

const SID = 'speaker-timeline-test-session'

afterEach(() => {
  clearSpeakerTimeline(SID)
})

describe('speaker-timeline (B-T3, C-T2)', () => {
  it('resolves nearest observation within window', () => {
    recordSpeakerObservation(SID, {
      displayName: 'Ada',
      confidence: 0.85,
      observedAt: 1_000,
      source: 'dom-active',
    })
    recordSpeakerObservation(SID, {
      displayName: 'Bob',
      confidence: 0.85,
      observedAt: 5_000,
      source: 'dom-active',
    })
    expect(resolveSpeakerAt(SID, 1_200, 2_000)?.displayName).toBe('Ada')
    expect(resolveSpeakerAt(SID, 4_800, 2_000)?.displayName).toBe('Bob')
  })

  it('returns null outside window', () => {
    recordSpeakerObservation(SID, {
      displayName: 'Ada',
      confidence: 0.85,
      observedAt: 1_000,
      source: 'dom-active',
    })
    expect(resolveSpeakerAt(SID, 10_000, 2_000)).toBeNull()
  })

  it('clears timeline', () => {
    recordSpeakerObservation(SID, {
      displayName: 'Ada',
      confidence: 0.9,
      observedAt: 1_000,
      source: 'dom-active',
    })
    clearSpeakerTimeline(SID)
    expect(resolveSpeakerAt(SID, 1_000)).toBeNull()
  })

  it('drops names not in participant set', () => {
    setSessionParticipants(SID, [{ displayName: 'Ada' }])
    recordSpeakerObservation(SID, {
      displayName: 'Hallucinated',
      confidence: 0.9,
      observedAt: 1_000,
      source: 'dom-active',
    })
    expect(resolveSpeakerAt(SID, 1_000)).toBeNull()
    recordSpeakerObservation(SID, {
      displayName: 'Ada',
      confidence: 0.9,
      observedAt: 1_100,
      source: 'dom-active',
    })
    expect(resolveSpeakerAt(SID, 1_100)?.displayName).toBe('Ada')
  })

  it('applyMicSelfBoost marks local', () => {
    const out = applyMicSelfBoost(
      {
        displayName: 'X',
        confidence: 0.6,
        observedAt: 1,
        source: 'dom-tile',
      },
      true,
    )
    expect(out.isLocalSelf).toBe(true)
    expect(out.confidence).toBeGreaterThanOrEqual(0.75)
  })
})
