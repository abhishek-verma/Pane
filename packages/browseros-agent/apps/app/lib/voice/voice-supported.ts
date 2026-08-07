/**
 * Whether voice input (dictation + voice mode) is available in this build.
 *
 * Transcription is handled locally via the Pane server's Whisper ASR —
 * the same engine used for meeting transcription.
 * @public
 */
export const VOICE_SUPPORTED: boolean = true
