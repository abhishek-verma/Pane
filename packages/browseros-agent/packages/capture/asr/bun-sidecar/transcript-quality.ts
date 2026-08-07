/**
 * Pure helpers for ASR windowing + transcript cleanup.
 * Kept free of bun/whisper imports so unit tests stay cheap.
 */

export const SAMPLE_RATE = 16_000
/** Wait for this much *new* audio before running Whisper (unless forced). */
export const MIN_WINDOW_SAMPLES = 10 * SAMPLE_RATE
/** Cap a single decode window so latency stays bounded. */
export const MAX_WINDOW_SAMPLES = 24 * SAMPLE_RATE
/** Overlap with prior audio for word-boundary context. */
export const OVERLAP_SAMPLES = Math.floor(1.0 * SAMPLE_RATE)
/** Minimum audio even when force=true (skip tiny tail noise). */
export const MIN_FORCE_SAMPLES = Math.floor(1.2 * SAMPLE_RATE)

/** Normal SRT crumbs and whisper.cpp glitches like `00:-16:-47,-260`. */
const TIMESTAMP_TOKEN = /^-?\d{1,3}:-?\d{1,3}:-?\d{1,3}[,.]-?\d{1,3}$/
const TIMESTAMP_PREFIX = /^(?:-?\d{1,3}:-?\d{1,3}:-?\d{1,3}[,.]-?\d{1,3}\s*)+/
const BRACKET_TAG = /^\[[A-Z0-9 _-]+\]$/i
const HALLUCINATION_ONLY =
  /^(?:\[(?:BLANK_AUDIO|MUSIC(?: PLAYING)?|SOUND(?: EFFECT)?|NOISE|SILENCE|APPLAUSE|LAUGHTER)\]|[.…]|-)$/i

export function peakNormalize(
  samples: Float32Array,
  targetPeak = 0.9,
): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i] ?? 0)
    if (a > peak) peak = a
  }
  if (peak < 1e-4 || peak >= targetPeak) return samples
  const gain = targetPeak / peak
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = (samples[i] ?? 0) * gain
  }
  return out
}

/** Strip whisper timestamp crumbs and bracket-only junk. */
export function cleanTranscriptText(raw: string): string {
  const parts = raw
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !BRACKET_TAG.test(p))
    .filter((p) => !TIMESTAMP_TOKEN.test(p))

  let text = parts.join(' ').replace(TIMESTAMP_PREFIX, '').trim()
  text = text.replace(/\s+/g, ' ').trim()
  // Belt-and-suspenders for glued timestamp+word tokens.
  text = text.replace(TIMESTAMP_PREFIX, '').trim()
  if (!text || HALLUCINATION_ONLY.test(text)) return ''
  if (BRACKET_TAG.test(text)) return ''
  return text
}

/**
 * Drop leading words already emitted (overlap re-decode).
 * Conservative: only strips a prefix that matches the tail of prior text.
 */
export function stripOverlapDuplicate(next: string, previous: string): string {
  const a = cleanTranscriptText(next)
  const b = cleanTranscriptText(previous)
  if (!a) return ''
  if (!b) return a

  const nextWords = a.split(/\s+/)
  const prevWords = b.split(/\s+/)
  const max = Math.min(nextWords.length, prevWords.length, 12)
  let overlap = 0
  for (let n = max; n >= 2; n--) {
    const prefix = nextWords.slice(0, n).join(' ').toLowerCase()
    const suffix = prevWords.slice(-n).join(' ').toLowerCase()
    if (prefix === suffix) {
      overlap = n
      break
    }
  }
  if (overlap === 0) return a
  return nextWords.slice(overlap).join(' ').trim()
}

export function decideAsrWindow(input: {
  totalSamples: number
  lastEndSample: number
  force?: boolean
}): { run: boolean; clipStart: number; clipEnd: number } | { run: false } {
  const unprocessed = input.totalSamples - input.lastEndSample
  if (unprocessed <= 0) return { run: false }

  const minNeeded = input.force ? MIN_FORCE_SAMPLES : MIN_WINDOW_SAMPLES
  if (unprocessed < minNeeded) return { run: false }

  const clipEnd = Math.min(
    input.totalSamples,
    input.lastEndSample + MAX_WINDOW_SAMPLES,
  )
  const clipStart = Math.max(0, input.lastEndSample - OVERLAP_SAMPLES)
  return { run: true, clipStart, clipEnd }
}

export function extractWhisperText(transcription: unknown): string {
  if (!Array.isArray(transcription)) return ''
  const pieces: string[] = []
  for (const row of transcription) {
    if (typeof row === 'string') {
      pieces.push(row)
      continue
    }
    if (!Array.isArray(row)) continue
    for (const cell of row) {
      if (typeof cell === 'string') {
        pieces.push(cell)
        continue
      }
      if (cell && typeof cell === 'object' && 'text' in cell) {
        const t = (cell as { text?: unknown }).text
        if (typeof t === 'string') pieces.push(t)
      }
    }
  }
  return cleanTranscriptText(pieces.join(' '))
}

/**
 * Extract transcript as separate utterances split by silence gaps.
 * Whisper returns timestamped segments — when two consecutive segments have a
 * gap > SILENCE_GAP_SECONDS, we treat them as separate utterances.
 */
const SILENCE_GAP_SECONDS = 1.5

interface WhisperSegment {
  start?: number
  end?: number
  text?: string
}

export function extractWhisperUtterances(transcription: unknown): string[] {
  if (!Array.isArray(transcription)) return []

  // Parse segments with timestamps
  const segments: WhisperSegment[] = []
  for (const row of transcription) {
    if (!row || typeof row !== 'object') continue
    if (Array.isArray(row)) {
      for (const cell of row) {
        if (cell && typeof cell === 'object' && 'text' in cell) {
          segments.push(cell as WhisperSegment)
        }
      }
    } else if ('text' in row) {
      segments.push(row as WhisperSegment)
    }
  }

  if (segments.length === 0) {
    // Fallback: no timestamped segments, return as single utterance
    const text = extractWhisperText(transcription)
    return text ? [text] : []
  }

  // Group segments by silence gaps
  const utterances: string[] = []
  let current: string[] = []
  let lastEnd = 0

  for (const seg of segments) {
    const text = cleanTranscriptText(seg.text ?? '')
    if (!text) continue

    const start = seg.start ?? lastEnd
    const gap = start - lastEnd

    if (gap >= SILENCE_GAP_SECONDS && current.length > 0) {
      utterances.push(current.join(' ').trim())
      current = []
    }

    current.push(text)
    lastEnd = seg.end ?? start
  }

  if (current.length > 0) {
    utterances.push(current.join(' ').trim())
  }

  return utterances.filter(Boolean)
}
