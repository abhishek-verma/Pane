/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Offscreen audio recorder — bundled with capture-offscreen.html.
 * MediaRecorder timeslice blobs after chunk 0 are cluster fragments; the server
 * concatenates 0..N before ASR so each feed is a valid WebM stream.
 */

const CHUNK_MS = 2_000

interface RecorderState {
  sessionId: string
  tabId: number
  sequence: number
  recorder: MediaRecorder
  cleanup: () => void
  includeMic: boolean
  serverUrl: string
  uploadErrors: number
}

const recorders = new Map<string, RecorderState>()

async function uploadCaptureChunk(input: {
  serverUrl: string
  sessionId: string
  sequence: number
  mimeType: string
  data: ArrayBuffer
  capturedAt?: number
}): Promise<void> {
  const bytes = new Uint8Array(input.data)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base = input.serverUrl.replace(/\/$/, '')
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
  })
  if (!res.ok) {
    throw new Error(`capture chunk failed (${res.status})`)
  }
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

  if (!input.includeMic) {
    return {
      stream: tabStream,
      cleanup: () => {
        for (const fn of cleanups) fn()
      },
      includeMic: false,
    }
  }

  const micStream = await openMicStream()
  cleanups.push(() => {
    for (const track of micStream.getTracks()) track.stop()
  })

  const audioContext = new AudioContext()
  cleanups.push(() => {
    if (audioContext.state !== 'closed') {
      audioContext.close().catch(() => undefined)
    }
  })

  const destination = audioContext.createMediaStreamDestination()
  audioContext.createMediaStreamSource(tabStream).connect(destination)
  audioContext.createMediaStreamSource(micStream).connect(destination)

  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => undefined)
  }

  return {
    stream: destination.stream,
    cleanup: () => {
      for (const fn of cleanups) fn()
    },
    includeMic: true,
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
  }

  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return
    const sequence = state.sequence
    state.sequence++
    void event.data.arrayBuffer().then(async (buffer) => {
      try {
        await uploadCaptureChunk({
          serverUrl: state.serverUrl,
          sessionId: input.sessionId,
          sequence,
          mimeType,
          data: buffer,
        })
      } catch (_err) {
        state.uploadErrors++
      }
    })
  })

  recorder.start(CHUNK_MS)
  recorders.set(input.sessionId, state)
  return { includeMic: opened.includeMic, chunksUploaded: 0 }
}

async function stopRecording(sessionId: string): Promise<void> {
  const state = recorders.get(sessionId)
  if (!state) return

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
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'capture-audio-start') {
    void startRecording(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    return true
  }

  if (message?.type === 'capture-audio-stop') {
    void stopRecording(message.payload.sessionId)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    return true
  }

  if (message?.type === 'capture-audio-status') {
    sendResponse({
      sessionIds: Array.from(recorders.keys()),
      sessions: Array.from(recorders.values()).map((state) => ({
        sessionId: state.sessionId,
        chunksUploaded: state.sequence,
        uploadErrors: state.uploadErrors,
      })),
    })
    return false
  }

  return false
})
