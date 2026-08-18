import { useEffect, useRef, useState } from 'react'
import {
  cancelDictationSession,
  createDictationSessionId,
  type DictationEventsHandle,
  openDictationEvents,
  postDictationFeed,
} from '@/lib/voice/live-dictation'
import {
  acquireMicLock,
  createMicLockOwnerId,
  MIC_IN_USE_MESSAGE,
  releaseMicLock,
  renewMicLock,
} from '@/lib/voice/mic-lock'
import { transcribeAudio } from '@/lib/voice/transcribe-audio'
import {
  type AudioCaptureHandle,
  describeCaptureError,
  openAudioCapture,
} from './audio-capture'
import {
  type AudioLevelMonitor,
  createAudioLevelMonitor,
  emptySample,
} from './audio-level-monitor'

// Well under the mic lock's staleness window, so a long recording keeps
// renewing its claim rather than looking abandoned to another window.
const MIC_LOCK_RENEW_MS = 5_000

// Sidecar's decideAsrWindow needs >=10s of unprocessed audio before a
// non-forced feed does real transcription work (anything less is a wasted
// decode-and-noop) — matching that as the steady cadence means every tick
// after the first reliably produces a caption instead of paying decode
// cost for nothing. The one exception is the very first tick: forced, at
// 4s, so the user sees their first live caption quickly while the buffer
// is still cheap to decode.
const LIVE_FEED_FIRST_DELAY_MS = 4_000
const LIVE_FEED_INTERVAL_MS = 10_000

const WAVEFORM_BAND_COUNT = 5

export interface VoiceInputState {
  isRecording: boolean
  isTranscribing: boolean
  audioLevels: number[]
  error: string | null
  partialTranscript: string
  canRetry: boolean
  onStartRecording: () => void
  onStopRecording: () => void
  retryTranscription: () => void
}

export interface UseVoiceInputReturn {
  isRecording: boolean
  isTranscribing: boolean
  transcript: string
  partialTranscript: string
  audioLevel: number
  audioLevels: number[]
  error: string | null
  canRetry: boolean
  startRecording: () => Promise<boolean>
  stopRecording: () => Promise<void>
  retryTranscription: () => Promise<void>
  clearTranscript: () => void
}

const EMPTY_LEVELS = emptySample(WAVEFORM_BAND_COUNT).levels

export function useVoiceInput(): UseVoiceInputReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [partialTranscript, setPartialTranscript] = useState('')
  const [audioLevel, setAudioLevel] = useState(0)
  const [audioLevels, setAudioLevels] = useState<number[]>(EMPTY_LEVELS)
  const [error, setError] = useState<string | null>(null)
  const [canRetry, setCanRetry] = useState(false)

  const captureRef = useRef<AudioCaptureHandle | null>(null)
  const monitorRef = useRef<AudioLevelMonitor | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const lastFailedBlobRef = useRef<Blob | null>(null)
  const transcribeAbortRef = useRef<AbortController | null>(null)
  const micLockOwnerIdRef = useRef(createMicLockOwnerId())
  const micLockRenewTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  )
  const dictationSessionIdRef = useRef<string | null>(null)
  const dictationEventsRef = useRef<DictationEventsHandle | null>(null)
  const liveFeedFirstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const liveFeedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  )
  const liveFeedInFlightRef = useRef<Promise<unknown> | null>(null)

  const stopLiveFeedTimers = () => {
    if (liveFeedFirstTimerRef.current !== null) {
      clearTimeout(liveFeedFirstTimerRef.current)
      liveFeedFirstTimerRef.current = null
    }
    if (liveFeedIntervalRef.current !== null) {
      clearInterval(liveFeedIntervalRef.current)
      liveFeedIntervalRef.current = null
    }
  }

  const releaseAll = () => {
    monitorRef.current?.stop()
    monitorRef.current = null
    captureRef.current?.close()
    captureRef.current = null
    setAudioLevel(0)
    setAudioLevels(EMPTY_LEVELS)
    if (micLockRenewTimerRef.current !== null) {
      clearInterval(micLockRenewTimerRef.current)
      micLockRenewTimerRef.current = null
    }
    void releaseMicLock(micLockOwnerIdRef.current)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup only needs to run on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      // Without this, a transcription in flight when the component
      // unmounts (nav away, panel closed) would keep running against
      // nothing — up to the 10-minute absolute ceiling — holding a slot
      // in the server's ASR scheduler the whole time.
      transcribeAbortRef.current?.abort()
      // Same idea for a live dictation session started but never
      // finalized — without this it'd sit registered against the shared
      // ASR worker until the server's own idle sweep reaps it.
      stopLiveFeedTimers()
      dictationEventsRef.current?.stop()
      dictationEventsRef.current = null
      if (dictationSessionIdRef.current) {
        void cancelDictationSession(dictationSessionIdRef.current)
        dictationSessionIdRef.current = null
      }
      releaseAll()
    }
  }, [])

  const startRecording = async (): Promise<boolean> => {
    try {
      setError(null)
      setTranscript('')
      lastFailedBlobRef.current = null
      setCanRetry(false)
      chunksRef.current = []

      const acquiredLock = await acquireMicLock(micLockOwnerIdRef.current)
      if (!acquiredLock) {
        setError(MIC_IN_USE_MESSAGE)
        return false
      }

      const capture = await openAudioCapture()
      captureRef.current = capture

      micLockRenewTimerRef.current = setInterval(() => {
        void renewMicLock(micLockOwnerIdRef.current)
      }, MIC_LOCK_RENEW_MS)

      const monitor = createAudioLevelMonitor({
        bandCount: WAVEFORM_BAND_COUNT,
      })
      monitor.subscribe((sample) => {
        setAudioLevels(sample.levels)
        setAudioLevel(sample.aggregate)
      })
      monitor.start(capture.analyser)
      monitorRef.current = monitor

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const mediaRecorder = new MediaRecorder(capture.stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.start(250)
      setIsRecording(true)

      const sessionId = createDictationSessionId()
      dictationSessionIdRef.current = sessionId
      setPartialTranscript('')
      dictationEventsRef.current = openDictationEvents(sessionId, {
        onSegment: setPartialTranscript,
      })

      const sendLiveFeed = (force: boolean) => {
        if (liveFeedInFlightRef.current) return
        if (chunksRef.current.length === 0) return
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const feed = postDictationFeed(sessionId, blob, {
          force,
          final: false,
        }).catch(() => {
          // Periodic feeds are best-effort — only the final feed's
          // failure needs to surface an error to the user.
        })
        liveFeedInFlightRef.current = feed
        void feed.finally(() => {
          if (liveFeedInFlightRef.current === feed) {
            liveFeedInFlightRef.current = null
          }
        })
      }

      liveFeedFirstTimerRef.current = setTimeout(() => {
        liveFeedFirstTimerRef.current = null
        sendLiveFeed(true)
        liveFeedIntervalRef.current = setInterval(() => {
          sendLiveFeed(false)
        }, LIVE_FEED_INTERVAL_MS)
      }, LIVE_FEED_FIRST_DELAY_MS)

      return true
    } catch (err) {
      releaseAll()
      setError(describeCaptureError(err))
      return false
    }
  }

  // Retry resends the full retained blob through the untouched one-shot
  // endpoint rather than replaying the incremental live-feed steps — no
  // new dictation session, no risk of orphaning one if the retry itself
  // fails, and it reuses transcribe-audio.ts's own inactivity/ceiling
  // timeout handling unchanged.
  const runRetryTranscription = async (audioBlob: Blob) => {
    transcribeAbortRef.current?.abort()
    const ac = new AbortController()
    transcribeAbortRef.current = ac

    setError(null)
    setPartialTranscript('')
    setIsTranscribing(true)
    try {
      const { text } = await transcribeAudio(audioBlob, {
        onPartial: setPartialTranscript,
        signal: ac.signal,
      })
      if (ac.signal.aborted) return
      const trimmed = text.trim()
      if (trimmed) {
        lastFailedBlobRef.current = null
        setCanRetry(false)
        setTranscript(trimmed)
      } else {
        // No blob to retry here — the audio was fine, there just wasn't
        // any speech in it, so re-sending it would fail the same way.
        lastFailedBlobRef.current = null
        setCanRetry(false)
        setError('No speech detected')
      }
    } catch (err) {
      if (ac.signal.aborted) return
      lastFailedBlobRef.current = audioBlob
      setCanRetry(true)
      setError(err instanceof Error ? err.message : 'Transcription failed')
    } finally {
      if (!ac.signal.aborted) {
        setIsTranscribing(false)
        setPartialTranscript('')
      }
    }
  }

  const stopRecording = async () => {
    const mediaRecorder = mediaRecorderRef.current

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return
    }

    await new Promise<void>((resolve) => {
      mediaRecorder.onstop = () => resolve()
      mediaRecorder.stop()
    })

    stopLiveFeedTimers()
    releaseAll()
    setIsRecording(false)

    const sessionId = dictationSessionIdRef.current
    dictationSessionIdRef.current = null
    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
    chunksRef.current = []

    if (audioBlob.size === 0) {
      setError('No audio recorded')
      dictationEventsRef.current?.stop()
      dictationEventsRef.current = null
      if (sessionId) void cancelDictationSession(sessionId)
      return
    }

    if (!sessionId) {
      // Shouldn't happen (a session is always started alongside
      // recording), but fall back to the one-shot path rather than lose
      // the recording if it somehow didn't get one.
      await runRetryTranscription(audioBlob)
      return
    }

    // Let any in-flight periodic feed settle first so the final feed
    // can't land out of sequence order ahead of it server-side.
    await liveFeedInFlightRef.current

    transcribeAbortRef.current?.abort()
    const ac = new AbortController()
    transcribeAbortRef.current = ac

    setError(null)
    setIsTranscribing(true)
    try {
      const { text } = await postDictationFeed(sessionId, audioBlob, {
        force: true,
        final: true,
        signal: ac.signal,
      })
      if (ac.signal.aborted) return
      dictationEventsRef.current?.stop()
      dictationEventsRef.current = null
      const trimmed = text?.trim() ?? ''
      if (trimmed) {
        lastFailedBlobRef.current = null
        setCanRetry(false)
        setTranscript(trimmed)
      } else {
        lastFailedBlobRef.current = null
        setCanRetry(false)
        setError('No speech detected')
      }
    } catch (err) {
      if (ac.signal.aborted) return
      dictationEventsRef.current?.stop()
      dictationEventsRef.current = null
      // The final feed's own catch already best-effort closes the
      // session server-side on failure, but cover the case where the
      // request never reached the server at all (offline, etc.).
      void cancelDictationSession(sessionId)
      lastFailedBlobRef.current = audioBlob
      setCanRetry(true)
      setError(err instanceof Error ? err.message : 'Transcription failed')
    } finally {
      if (!ac.signal.aborted) {
        setIsTranscribing(false)
        setPartialTranscript('')
      }
    }
  }

  const retryTranscription = async () => {
    if (isTranscribing) return
    const blob = lastFailedBlobRef.current
    if (!blob) return
    await runRetryTranscription(blob)
  }

  const clearTranscript = () => {
    setTranscript('')
    setError(null)
  }

  return {
    isRecording,
    isTranscribing,
    transcript,
    partialTranscript,
    audioLevel,
    audioLevels,
    error,
    canRetry,
    startRecording,
    stopRecording,
    retryTranscription,
    clearTranscript,
  }
}
