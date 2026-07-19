/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import {
  correlateMicSelfBoost,
  isLocalSpeakingFromRms,
  rmsFromSamples,
} from './mic-energy'

describe('mic-energy (C-T3)', () => {
  it('computes RMS', () => {
    expect(rmsFromSamples([0, 0, 0])).toBe(0)
    expect(rmsFromSamples([1, -1, 1, -1])).toBeCloseTo(1)
  })

  it('thresholds local speaking', () => {
    expect(isLocalSpeakingFromRms(0.001)).toBe(false)
    expect(isLocalSpeakingFromRms(0.05)).toBe(true)
  })

  it('boosts self when mic energy high', () => {
    const out = correlateMicSelfBoost({
      displayName: 'Guest',
      isLocalSelf: false,
      confidence: 0.65,
      localSpeaking: true,
      selfName: 'Ada',
    })
    expect(out.isLocalSelf).toBe(true)
    expect(out.displayName).toBe('Ada')
    expect(out.confidence).toBeGreaterThanOrEqual(0.75)
  })

  it('leaves labels alone when mic quiet', () => {
    const out = correlateMicSelfBoost({
      displayName: 'Guest',
      confidence: 0.85,
      localSpeaking: false,
    })
    expect(out.isLocalSelf).toBe(false)
    expect(out.displayName).toBe('Guest')
  })
})
