import { useEffect, useRef, useState } from 'react'
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
      return true
    } catch (err) {
      releaseAll()
      setError(describeCaptureError(err))
      return false
    }
  }

  const runTranscription = async (audioBlob: Blob) => {
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

    releaseAll()
    setIsRecording(false)

    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' })
    chunksRef.current = []

    if (audioBlob.size === 0) {
      setError('No audio recorded')
      return
    }

    await runTranscription(audioBlob)
  }

  const retryTranscription = async () => {
    if (isTranscribing) return
    const blob = lastFailedBlobRef.current
    if (!blob) return
    await runTranscription(blob)
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
