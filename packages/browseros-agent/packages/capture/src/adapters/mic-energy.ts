/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Correlate mic RMS with local speaking for optional self-boost on speaker labels.
 */

/** RMS above this (0–1 float samples) counts as local speaking. */
export const MIC_SPEAKING_RMS_THRESHOLD = 0.02

export function rmsFromSamples(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] ?? 0
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}

export function isLocalSpeakingFromRms(
  rms: number,
  threshold = MIC_SPEAKING_RMS_THRESHOLD,
): boolean {
  return rms >= threshold
}

/**
 * When mic energy is high and page label is uncertain/non-self, prefer self.
 */
export function correlateMicSelfBoost(input: {
  displayName: string
  isLocalSelf?: boolean
  confidence: number
  localSpeaking: boolean
  selfName?: string
}): { displayName: string; isLocalSelf: boolean; confidence: number } {
  if (!input.localSpeaking) {
    return {
      displayName: input.displayName,
      isLocalSelf: Boolean(input.isLocalSelf),
      confidence: input.confidence,
    }
  }
  const name =
    input.selfName?.trim() ||
    (input.isLocalSelf ? input.displayName : 'You') ||
    'You'
  return {
    displayName: name,
    isLocalSelf: true,
    confidence: Math.max(input.confidence, 0.75),
  }
}
