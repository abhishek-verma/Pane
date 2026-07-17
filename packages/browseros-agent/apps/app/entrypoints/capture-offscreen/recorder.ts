/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Offscreen audio recorder — bundled with capture-offscreen.html.
 * MediaRecorder timeslice blobs after chunk 0 are cluster fragments; the server
 * concatenates 0..N before ASR so each feed is a valid WebM stream.
 */

import {
  onRuntimeMessage,
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'

const CHUNK_MS = 2_000
const UPLOAD_TIMEOUT_MS = 30_000
const UPLOAD_MAX_ATTEMPTS = 3
/** After this many consecutive failed chunks, ask background to fail the session. */
const MAX_CONSECUTIVE_UPLOAD_ERRORS = 5

interface RecorderState {
  sessionId: string
  tabId: number
  sequence: number
  recorder: MediaRecorder
  cleanup: () => void
  includeMic: boolean
  serverUrl: string
  uploadErrors: number
  /** Serializes uploads so stream.webm append order matches MediaRecorder order. */
  uploadChain: Promise<void>
  failingOut: boolean
}

const recorders = new Map<string, RecorderState>()

async function resolveLiveServerUrl(fallback: string): Promise<string> {
  try {
    const response = await sendRuntimeMessage(
      RuntimeMessageType.getCaptureServerUrl,
    )
    if (response?.serverUrl) return response.serverUrl
  } catch {
    // Background may be restarting; fall back to the URL from start.
  }
  return fallback
}

async function uploadCaptureChunk(input: {
  serverUrl: string
  sessionId: string
  sequence: number
  mimeType: string
  data: ArrayBuffer
  capturedAt?: number
}): Promise<string> {
  const bytes = new Uint8Array(input.data)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const serverUrl = await resolveLiveServerUrl(input.serverUrl)
  const base = serverUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/capture/chunk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: input.sessionId,
      sequence: input.sequence,
      mimeType: input.mimeType,
      dataBase64: btoa(binary),
      capturedAt: input.capturedAt ?? Date.now(),
    }),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `capture chunk failed (${res.status})${body ? `: ${body.slice(0, 200)}` : ''}`,
    )
  }
  return serverUrl
}

async function openTabAudioStream(streamId: string): Promise<MediaStream> {
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

async function openMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  })
}

async function openMixedCaptureStream(input: {
  streamId: string
  includeMic: boolean
}): Promise<{ stream: MediaStream; cleanup: () => void; includeMic: boolean }> {
  const tabStream = await openTabAudioStream(input.streamId)
  const cleanups: Array<() => void> = [
    () => {
      for (const track of tabStream.getTracks()) track.stop()
    },
  ]

  // chrome.tabCapture / chromeMediaSource:'tab' mutes the tab for the user
  // while the capture stream is live. Route tab audio to AudioContext.destination
  // so meeting participants stay audible during recording.
  const audioContext = new AudioContext()
  cleanups.push(() => {
    if (audioContext.state !== 'closed') {
      audioContext.close().catch(() => undefined)
    }
  })

  const tabSource = audioContext.createMediaStreamSource(tabStream)
  tabSource.connect(audioContext.destination)

  const destination = audioContext.createMediaStreamDestination()
  tabSource.connect(destination)

  let includeMic = false
  if (input.includeMic) {
    const micStream = await openMicStream()
    cleanups.push(() => {
      for (const track of micStream.getTracks()) track.stop()
    })
    // Mic goes to the recorder only — never to speakers (echo).
    audioContext.createMediaStreamSource(micStream).connect(destination)
    includeMic = true
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => undefined)
  }

  return {
    stream: destination.stream,
    cleanup: () => {
      for (const fn of cleanups) fn()
    },
    includeMic,
  }
}

async function startRecording(input: {
  sessionId: string
  tabId: number
  streamId: string
  serverUrl: string
  includeMic?: boolean
}): Promise<{ includeMic: boolean; chunksUploaded: number }> {
  if (recorders.has(input.sessionId)) {
    const existing = recorders.get(input.sessionId)
    return {
      includeMic: existing?.includeMic ?? false,
      chunksUploaded: existing?.sequence ?? 0,
    }
  }

  if (!input.serverUrl) {
    throw new Error('Capture server URL missing')
  }

  const opened = await openMixedCaptureStream({
    streamId: input.streamId,
    includeMic: input.includeMic !== false,
  })

  const liveTracks = opened.stream
    .getAudioTracks()
    .filter((track) => track.readyState === 'live')
  if (liveTracks.length === 0) {
    opened.cleanup()
    throw new Error('Capture stream has no live audio tracks')
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const recorder = new MediaRecorder(opened.stream, { mimeType })
  const state: RecorderState = {
    sessionId: input.sessionId,
    tabId: input.tabId,
    sequence: 0,
    recorder,
    cleanup: opened.cleanup,
    includeMic: opened.includeMic,
    serverUrl: input.serverUrl,
    uploadErrors: 0,
    uploadChain: Promise.resolve(),
    failingOut: false,
  }

  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return
    if (state.failingOut) return
    const sequence = state.sequence
    state.sequence++
    const bufferPromise = event.data.arrayBuffer()
    // Keep uploads strictly ordered so server stream.webm stays a valid WebM.
    state.uploadChain = state.uploadChain
      .then(async () => {
        const buffer = await bufferPromise
        for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt++) {
          try {
            const serverUrl = await uploadCaptureChunk({
              serverUrl: state.serverUrl,
              sessionId: input.sessionId,
              sequence,
              mimeType,
              data: buffer,
            })
            state.serverUrl = serverUrl
            state.uploadErrors = 0
            return
          } catch {
            state.serverUrl = await resolveLiveServerUrl(state.serverUrl)
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
          }
        }
        state.uploadErrors++
        if (
          state.uploadErrors >= MAX_CONSECUTIVE_UPLOAD_ERRORS &&
          !state.failingOut
        ) {
          state.failingOut = true
          // Must not await stopCapture here: it stops this recorder and would
          // deadlock if stopRecording waited on this uploadChain.
          void sendRuntimeMessage(RuntimeMessageType.stopCapture, {
            sessionId: input.sessionId,
          }).catch(() => undefined)
        }
      })
      .catch(() => undefined)
  })

  recorder.start(CHUNK_MS)
  recorders.set(input.sessionId, state)
  return { includeMic: opened.includeMic, chunksUploaded: 0 }
}

async function stopRecording(sessionId: string): Promise<void> {
  const state = recorders.get(sessionId)
  if (!state) return
  state.failingOut = true

  await new Promise<void>((resolve) => {
    const finish = () => {
      state.cleanup()
      recorders.delete(sessionId)
      resolve()
    }
    if (state.recorder.state === 'inactive') {
      finish()
      return
    }
    state.recorder.addEventListener('stop', () => finish(), { once: true })
    state.recorder.stop()
  })
  // Do not await state.uploadChain — a failing upload may be the caller of
  // stopCapture, which would deadlock waiting for itself.
}

onRuntimeMessage(RuntimeMessageType.captureAudioStart, async ({ data }) => {
  try {
    const result = await startRecording(data)
    return { ok: true, ...result }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
})

onRuntimeMessage(RuntimeMessageType.captureAudioStop, async ({ data }) => {
  try {
    await stopRecording(data.sessionId)
    return { ok: true }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
})

onRuntimeMessage(RuntimeMessageType.captureAudioStatus, () => ({
  sessionIds: Array.from(recorders.keys()),
  sessions: Array.from(recorders.values()).map((state) => ({
    sessionId: state.sessionId,
    chunksUploaded: state.sequence,
    uploadErrors: state.uploadErrors,
  })),
}))
