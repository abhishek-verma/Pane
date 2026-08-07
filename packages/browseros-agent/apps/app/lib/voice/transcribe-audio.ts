export interface TranscribeResult {
  text: string
  avgLogprob?: number
}

/**
 * Voice dictation via local transcription — not yet implemented.
 * Tracked in: M6.2 local TranscriptionProvider.
 */
export async function transcribeAudio(
  _audioBlob: Blob,
): Promise<TranscribeResult> {
  throw new Error(
    'Voice dictation is not yet available. Local transcription support is coming in a future release.',
  )
}
