/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { uploadCaptureChunk } from './capture-api'

const CHUNK_MS = 4_000

interface RecorderState {
  sessionId: string
  tabId: number
  sequence: number
  recorder: MediaRecorder
  stream: MediaStream
}

const recorders = new Map<string, RecorderState>()

async function resolveStreamId(tabId: number): Promise<string> {
  const adapter = getBrowserOSAdapter()
  if (adapter.isAPIAvailable('captureTabAudio')) {
    return new Promise((resolve, reject) => {
      chrome.browserOS.captureTabAudio(
        tabId,
        { captureClass: 'meeting', bucketId: 'default' },
        (result) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }
          resolve(result.streamId)
        },
      )
    })
  }

  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(
          new Error(
            chrome.runtime.lastError?.message ??
              'tabCapture stream unavailable',
          ),
        )
        return
      }
      resolve(streamId)
    })
  })
}

async function openTabAudioStream(tabId: number): Promise<MediaStream> {
  const streamId = await resolveStreamId(tabId)
  return navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    // biome-ignore lint/suspicious/noExplicitAny: Chrome-specific constraint
  } as any)
}

export async function startTabAudioCapture(input: {
  sessionId: string
  tabId: number
}): Promise<void> {
  if (recorders.has(input.sessionId)) return

  const stream = await openTabAudioStream(input.tabId)
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType })
  const state: RecorderState = {
    sessionId: input.sessionId,
    tabId: input.tabId,
    sequence: 0,
    recorder,
    stream,
  }

  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return
    const sequence = state.sequence++
    void event.data.arrayBuffer().then((buffer) =>
      uploadCaptureChunk({
        sessionId: input.sessionId,
        sequence,
        mimeType,
        data: buffer,
      }).catch(() => null),
    )
  })

  recorder.start(CHUNK_MS)
  recorders.set(input.sessionId, state)
}

export async function stopTabAudioCapture(sessionId: string): Promise<void> {
  const state = recorders.get(sessionId)
  if (!state) return

  if (state.recorder.state !== 'inactive') {
    state.recorder.stop()
  }
  for (const track of state.stream.getTracks()) {
    track.stop()
  }
  recorders.delete(sessionId)

  const adapter = getBrowserOSAdapter()
  if (adapter.isAPIAvailable('stopCaptureTabAudio')) {
    chrome.browserOS.stopCaptureTabAudio(state.tabId, () => {})
  }
}

export function isRecording(sessionId: string): boolean {
  return recorders.has(sessionId)
}

export function recordingSessionIds(): string[] {
  return Array.from(recorders.keys())
}
