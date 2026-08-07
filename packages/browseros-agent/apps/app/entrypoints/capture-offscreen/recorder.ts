/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Offscreen audio recorder — dual MediaRecorder (mixed + optional mic).
 * Durable pending-upload buffer survives transient server failures.
 */

import {
  onRuntimeMessage,
  RuntimeMessageType,
  sendRuntimeMessage,
} from '@/lib/messaging/runtime/runtimeMessages'

const BROWSEROS_PROFILE_ID_HEADER = 'X-BrowserOS-Profile-Id'

const CHUNK_MS = 2_000
const UPLOAD_TIMEOUT_MS = 30_000
const UPLOAD_MAX_ATTEMPTS = 5
const MAX_BUFFERED_CHUNKS = 120
/** Mic RMS above this counts as local speaking (matches capture mic-energy). */
const MIC_SPEAKING_RMS = 0.02
const MIC_LEVEL_POLL_MS = 200

type TrackName = 'mixed' | 'mic'

interface PendingChunk {
  sequence: number
  track: TrackName
  mimeType: string
  dataBase64: string
  capturedAt: number
}

interface TrackRecorder {
  recorder: MediaRecorder
  sequence: number
}

interface RecorderState {
  sessionId: string
  tabId: number
  cleanup: () => void
  includeMic: boolean
  serverUrl: string
  profileKey: string
  uploadErrors: number
  uploadChain: Promise<void>
  failingOut: boolean
  mixed: TrackRecorder
  mic?: TrackRecorder
  pending: PendingChunk[]
  localSpeaking: boolean
}

const recorders = new Map<string, RecorderState>()
const micSpeakingBySession = new Map<string, boolean>()

function bufferKey(sessionId: string): string {
  return `capturePending:${sessionId}`
}

async function loadPending(sessionId: string): Promise<PendingChunk[]> {
  try {
    const key = bufferKey(sessionId)
    const stored = await chrome.storage.local.get(key)
    const value = stored[key]
    return Array.isArray(value) ? (value as PendingChunk[]) : []
  } catch {
    return []
  }
}

async function savePending(
  sessionId: string,
  pending: PendingChunk[],
): Promise<void> {
  try {
    await chrome.storage.local.set({ [bufferKey(sessionId)]: pending })
  } catch {
    /* ignore quota */
  }
}

async function clearPending(sessionId: string): Promise<void> {
  try {
    await chrome.storage.local.remove(bufferKey(sessionId))
  } catch {
    /* ignore */
  }
}

async function resolveLiveServerUrl(fallback: string): Promise<string> {
  try {
    const response = await sendRuntimeMessage(
      RuntimeMessageType.getCaptureServerUrl,
    )
    if (response?.serverUrl) return response.serverUrl
  } catch {
    /* fall through */
  }
  return fallback
}

function bytesToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function uploadCaptureChunk(input: {
  serverUrl: string
  sessionId: string
  sequence: number
  mimeType: string
  dataBase64: string
  capturedAt?: number
  track: TrackName
  profileKey: string
}): Promise<string> {
  const serverUrl = await resolveLiveServerUrl(input.serverUrl)
  const base = serverUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/capture/chunk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [BROWSEROS_PROFILE_ID_HEADER]: input.profileKey,
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      sequence: input.sequence,
      mimeType: input.mimeType,
      dataBase64: input.dataBase64,
      capturedAt: input.capturedAt ?? Date.now(),
      track: input.track,
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

/**
 * Soft mic constraints: do not enable AEC/NS/AGC on Pane's recorder mic.
 * Meet/Zoom already own voice processing; fighting that on macOS is what
 * previously made guests go silent. Pattern matches TabScribe / Recall.ai
 * (tabCapture + getUserMedia mixed in one AudioContext).
 */
async function openMicStream(): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch {
    return null
  }
}

async function openCaptureStreams(input: {
  streamId: string
  includeMic: boolean
  sessionId: string
}): Promise<{
  mixed: MediaStream
  cleanup: () => void
  includeMic: boolean
}> {
  const tabStream = await openTabAudioStream(input.streamId)
  const cleanups: Array<() => void> = [
    () => {
      for (const track of tabStream.getTracks()) track.stop()
    },
  ]

  const audioContext = new AudioContext()
  cleanups.push(() => {
    if (audioContext.state !== 'closed') {
      audioContext.close().catch(() => undefined)
    }
  })

  const tabSource = audioContext.createMediaStreamSource(tabStream)
  // Chrome mutes the captured tab's local playback; loop back so the
  // user still hears remote participants through the offscreen context.
  tabSource.connect(audioContext.destination)

  const mixedDest = audioContext.createMediaStreamDestination()
  tabSource.connect(mixedDest)

  let includeMic = false
  if (input.includeMic) {
    const micStream = await openMicStream()
    if (micStream) {
      const micSource = audioContext.createMediaStreamSource(micStream)
      // Mic into the mix only — never to destination (feedback / howl).
      micSource.connect(mixedDest)

      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      micSource.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const levelTimer = setInterval(() => {
        try {
          analyser.getFloatTimeDomainData(samples)
          let sum = 0
          for (let i = 0; i < samples.length; i++) {
            const v = samples[i] ?? 0
            sum += v * v
          }
          const rms = Math.sqrt(sum / samples.length)
          const speaking = rms >= MIC_SPEAKING_RMS
          micSpeakingBySession.set(input.sessionId, speaking)
          const state = recorders.get(input.sessionId)
          if (state) state.localSpeaking = speaking
        } catch {
          /* analyser may be gone during teardown */
        }
      }, MIC_LEVEL_POLL_MS)
      cleanups.push(() => {
        clearInterval(levelTimer)
        micSpeakingBySession.delete(input.sessionId)
      })

      cleanups.push(() => {
        for (const track of micStream.getTracks()) track.stop()
      })
      includeMic = true
    }
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => undefined)
  }

  return {
    mixed: mixedDest.stream,
    cleanup: () => {
      for (const fn of cleanups) fn()
    },
    includeMic,
  }
}

function wireTrack(
  state: RecorderState,
  track: TrackName,
  recorder: MediaRecorder,
  mimeType: string,
): void {
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size === 0) return
    if (state.failingOut) return
    const tr = track === 'mixed' ? state.mixed : state.mic
    if (!tr) return
    const sequence = tr.sequence
    tr.sequence++
    const bufferPromise = event.data.arrayBuffer()
    state.uploadChain = state.uploadChain
      .then(async () => {
        const buffer = await bufferPromise
        const pending: PendingChunk = {
          sequence,
          track,
          mimeType,
          dataBase64: bytesToBase64(buffer),
          capturedAt: Date.now(),
        }
        await flushChunk(state, pending)
      })
      .catch(() => undefined)
  })
  recorder.start(CHUNK_MS)
}

async function flushChunk(
  state: RecorderState,
  chunk: PendingChunk,
): Promise<void> {
  for (let attempt = 0; attempt < UPLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      const serverUrl = await uploadCaptureChunk({
        serverUrl: state.serverUrl,
        sessionId: state.sessionId,
        sequence: chunk.sequence,
        mimeType: chunk.mimeType,
        dataBase64: chunk.dataBase64,
        capturedAt: chunk.capturedAt,
        track: chunk.track,
        profileKey: state.profileKey,
      })
      state.serverUrl = serverUrl
      state.uploadErrors = 0
      // Drop from durable buffer if present
      state.pending = state.pending.filter(
        (p) => !(p.sequence === chunk.sequence && p.track === chunk.track),
      )
      await savePending(state.sessionId, state.pending)
      return
    } catch {
      state.serverUrl = await resolveLiveServerUrl(state.serverUrl)
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  // Buffer for later — do not stop the meeting on transient failures.
  state.pending.push(chunk)
  if (state.pending.length > MAX_BUFFERED_CHUNKS) {
    state.pending = state.pending.slice(-MAX_BUFFERED_CHUNKS)
  }
  await savePending(state.sessionId, state.pending)
  state.uploadErrors++
}

async function flushPendingBuffer(state: RecorderState): Promise<void> {
  const queued = [...state.pending]
  for (const chunk of queued) {
    await flushChunk(state, chunk)
  }
}

async function startRecording(input: {
  sessionId: string
  tabId: number
  streamId: string
  serverUrl: string
  includeMic?: boolean
  profileKey: string
}): Promise<{ includeMic: boolean; chunksUploaded: number }> {
  if (recorders.has(input.sessionId)) {
    const existing = recorders.get(input.sessionId)
    return {
      includeMic: existing?.includeMic ?? false,
      chunksUploaded: existing?.mixed.sequence ?? 0,
    }
  }

  if (!input.serverUrl) {
    throw new Error('Capture server URL missing')
  }

  const opened = await openCaptureStreams({
    streamId: input.streamId,
    // Default on: industry pattern mixes tab + mic into one recorder.
    includeMic: input.includeMic !== false,
    sessionId: input.sessionId,
  })

  const liveTracks = opened.mixed
    .getAudioTracks()
    .filter((track) => track.readyState === 'live')
  if (liveTracks.length === 0) {
    opened.cleanup()
    throw new Error('Capture stream has no live audio tracks')
  }

  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'

  // One MediaRecorder on the mixed stream (tab + mic). Avoid a second
  // recorder on the raw mic — that doubled device contention on macOS.
  const mixedRecorder = new MediaRecorder(opened.mixed, { mimeType })
  const state: RecorderState = {
    sessionId: input.sessionId,
    tabId: input.tabId,
    cleanup: opened.cleanup,
    includeMic: opened.includeMic,
    serverUrl: input.serverUrl,
    profileKey: input.profileKey,
    uploadErrors: 0,
    uploadChain: Promise.resolve(),
    failingOut: false,
    mixed: { recorder: mixedRecorder, sequence: 0 },
    pending: await loadPending(input.sessionId),
    localSpeaking: false,
  }

  wireTrack(state, 'mixed', mixedRecorder, mimeType)

  recorders.set(input.sessionId, state)
  // Retry any durable buffered chunks from a prior offscreen death.
  state.uploadChain = state.uploadChain
    .then(() => flushPendingBuffer(state))
    .catch(() => undefined)

  return { includeMic: opened.includeMic, chunksUploaded: 0 }
}

async function stopRecording(sessionId: string): Promise<void> {
  const state = recorders.get(sessionId)
  if (!state) return
  state.failingOut = true

  const stopOne = (recorder: MediaRecorder) =>
    new Promise<void>((resolve) => {
      if (recorder.state === 'inactive') {
        resolve()
        return
      }
      recorder.addEventListener('stop', () => resolve(), { once: true })
      recorder.stop()
    })

  await stopOne(state.mixed.recorder)
  if (state.mic) await stopOne(state.mic.recorder)
  state.cleanup()
  recorders.delete(sessionId)
  await clearPending(sessionId)
}

onRuntimeMessage(RuntimeMessageType.captureAudioStart, async ({ data }) => {
  try {
    const result = await startRecording({
      sessionId: data.sessionId,
      tabId: data.tabId,
      streamId: data.streamId,
      serverUrl: data.serverUrl,
      includeMic: data.includeMic,
      profileKey: data.profileKey,
    })
    return { ok: true as const, ...result }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
})

onRuntimeMessage(RuntimeMessageType.captureAudioStop, async ({ data }) => {
  await stopRecording(data.sessionId)
  return { ok: true as const }
})

onRuntimeMessage(RuntimeMessageType.captureAudioStatus, async () => {
  const sessions = Array.from(recorders.entries()).map(
    ([sessionId, state]) => ({
      sessionId,
      chunksUploaded: state.mixed.sequence,
      uploadErrors: state.uploadErrors,
    }),
  )
  return {
    sessionIds: sessions.map((session) => session.sessionId),
    sessions,
  }
})

onRuntimeMessage(RuntimeMessageType.captureMicSpeaking, async ({ data }) => {
  const state = recorders.get(data.sessionId)
  return {
    localSpeaking:
      state?.localSpeaking ?? micSpeakingBySession.get(data.sessionId) ?? false,
  }
})
