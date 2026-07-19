/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Offscreen documents cannot show the mic permission prompt. Prime access
 * once from a visible extension page (settings / new tab) so meeting capture
 * can open getUserMedia in the offscreen document.
 */

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported'

export async function queryMicPermission(): Promise<MicPermissionState> {
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported'
  try {
    const status = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    })
    if (status.state === 'granted') return 'granted'
    if (status.state === 'denied') return 'denied'
    return 'prompt'
  } catch {
    return 'prompt'
  }
}

/** Open+close a mic stream to trigger the Allow prompt if needed. */
export async function primeMicrophonePermission(): Promise<{
  ok: boolean
  error?: string
}> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: 'Microphone API unavailable' }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
    for (const track of stream.getTracks()) track.stop()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
