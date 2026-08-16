import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { readSseFrames } from '@/lib/sse/read-sse-frames'

const BIAS_PROMPT =
  'Transcript of a user dictating a chat message. Do not describe non-speech sounds.'

// Long recordings are transcribed as sequential ~24s windows server-side, so
// wall-clock time scales with recording length rather than being fixed. We
// watch for stream inactivity instead of racing a flat deadline against the
// whole request — the server sends a segment/heartbeat at least this often
// while it's still working.
const INACTIVITY_TIMEOUT_MS = 20_000
// Last-resort safety net against a wedged server process, not a per-length
// budget — no real recording should ever come close to this.
const ABSOLUTE_CEILING_MS = 10 * 60_000

export interface TranscribeResult {
  text: string
  avgLogprob?: number
}

export interface TranscribeAudioOptions {
  /** Called with the cumulative transcript as each ~24s segment finishes. */
  onPartial?: (cumulativeText: string) => void
  signal?: AbortSignal
}

/**
 * Transcribe a voice recording via the local Pane server's Whisper ASR.
 *
 * Sends a single audio blob (webm/opus from MediaRecorder) to
 * POST /capture/asr/transcribe on the local server, which feeds it through
 * the same shared Whisper sidecar used for meeting transcription and streams
 * the transcript back over SSE as each chunk finishes.
 * No external services — fully local.
 */
export async function transcribeAudio(
  audioBlob: Blob,
  options?: TranscribeAudioOptions,
): Promise<TranscribeResult> {
  const serverUrl = await getAgentServerUrl()
  if (!serverUrl) {
    throw new Error('Pane server is not running. Make sure Pane is open.')
  }

  const formData = new FormData()
  // Name the file so the server can infer the mime type if needed
  formData.append('file', audioBlob, 'recording.webm')
  // Include the bias prompt as a hint (server may or may not use it)
  formData.append('prompt', BIAS_PROMPT)

  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  options?.signal?.addEventListener('abort', onCallerAbort)

  let inactivityTimer: ReturnType<typeof setTimeout> | null = null
  const resetInactivityTimer = () => {
    if (inactivityTimer !== null) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(
      () => controller.abort(),
      INACTIVITY_TIMEOUT_MS,
    )
  }
  const ceilingTimer = setTimeout(() => controller.abort(), ABSOLUTE_CEILING_MS)

  const cleanup = () => {
    options?.signal?.removeEventListener('abort', onCallerAbort)
    if (inactivityTimer !== null) clearTimeout(inactivityTimer)
    clearTimeout(ceilingTimer)
  }

  try {
    // The inactivity watchdog only measures server activity once the SSE
    // stream is established — the upload itself (and connection setup) has
    // no progress signal to reset it against, so it's bounded only by the
    // absolute ceiling below until the first frame arrives.
    const response = await agentFetch(`${serverUrl}/capture/asr/transcribe`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    })

    if (!response.ok) {
      const body: { error?: string } = await response
        .json()
        .catch(() => ({ error: 'Transcription failed' }))
      throw new Error(body.error ?? `Transcription failed: ${response.status}`)
    }
    if (!response.body) {
      throw new Error('Transcription failed: empty response')
    }

    resetInactivityTimer()
    let finalText: string | undefined
    for await (const frame of readSseFrames(response.body)) {
      resetInactivityTimer()
      if (frame.event === 'segment') {
        const data: { text: string; cumulative: string } = JSON.parse(
          frame.data,
        )
        options?.onPartial?.(data.cumulative)
      } else if (frame.event === 'final') {
        const data: { text: string } = JSON.parse(frame.data)
        finalText = data.text ?? ''
      } else if (frame.event === 'error') {
        const data: { error?: string } = JSON.parse(frame.data)
        throw new Error(data.error ?? 'Transcription failed')
      }
      // heartbeat: no-op, just resets the inactivity watchdog above
    }

    if (finalText === undefined) {
      throw new Error('Transcription connection closed unexpectedly')
    }
    return { text: finalText }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      if (options?.signal?.aborted) throw new Error('Transcription cancelled')
      throw new Error('Transcription timed out. Please try again.')
    }
    throw err
  } finally {
    cleanup()
  }
}
