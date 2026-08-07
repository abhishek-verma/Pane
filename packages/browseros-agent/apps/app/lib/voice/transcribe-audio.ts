import { getAgentServerUrl } from '@/lib/browseros/helpers'

const BIAS_PROMPT =
  'Transcript of a user dictating a chat message. Do not describe non-speech sounds.'

export interface TranscribeResult {
  text: string
  avgLogprob?: number
}

/**
 * Transcribe a voice recording via the local Pane server's Whisper ASR.
 *
 * Sends a single audio blob (webm/opus from MediaRecorder) to
 * POST /capture/asr/transcribe on the local server, which feeds it through
 * the same shared Whisper sidecar used for meeting transcription.
 * No external services — fully local.
 */
export async function transcribeAudio(
  audioBlob: Blob,
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

  const response = await fetch(`${serverUrl}/capture/asr/transcribe`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const body: { error?: string } = await response
      .json()
      .catch(() => ({ error: 'Transcription failed' }))
    throw new Error(body.error ?? `Transcription failed: ${response.status}`)
  }

  const result: { text: string } = await response.json()
  return { text: result.text ?? '' }
}
