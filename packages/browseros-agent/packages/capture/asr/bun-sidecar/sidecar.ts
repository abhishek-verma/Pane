#!/usr/bin/env bun

/**
 * BrowserOS ASR sidecar — Bun/TypeScript, no Python required.
 *
 * Protocol (same as Python sidecar):
 *   stdin:  newline-delimited JSON AudioChunk objects
 *             { sessionId, sequence, mimeType, capturedAt, dataBase64 }
 *   stdout: newline-delimited JSON events
 *             { kind: "ack", sequence }
 *             { kind: "partial"|"final", id, sessionId, text, capturedAt }
 *   stderr: diagnostic logs
 *
 * Runtime: bundled third_party/bun (no system deps needed).
 * STT:     @kutalia/whisper-node-addon (whisper.cpp, Metal/Vulkan GPU).
 * Decode:  @audio/webm-decode (pure WASM, handles MediaRecorder WebM/Opus).
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MODEL_NAME = process.env.BROWSEROS_ASR_MODEL ?? 'ggml-small.en'
const MOCK_MODE = process.env.BROWSEROS_ASR_MOCK === '1'

/**
 * Return the path to the whisper GGML model file, downloading it if absent.
 * Models go to ~/Library/Application Support/Pane/asr-models/ on macOS,
 * or ~/.local/share/Pane/asr-models/ on Linux.
 */
function modelDir(): string {
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Pane', 'asr-models')
      : join(homedir(), '.local', 'share', 'Pane', 'asr-models')
  mkdirSync(base, { recursive: true })
  return base
}

async function ensureModel(): Promise<string> {
  const dir = modelDir()
  const path = join(dir, `${MODEL_NAME}.bin`)
  if (existsSync(path)) return path

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}.bin`
  log(`[asr] Downloading Whisper model ${MODEL_NAME} from HuggingFace…`)
  log(`[asr] This happens once. Model will be cached at: ${path}`)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Model download failed: ${res.status} ${url}`)

  const total = Number(res.headers.get('content-length') ?? 0)
  if (!res.body) throw new Error('Model download response has no body')
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    if (total > 0) {
      const pct = Math.round((received / total) * 100)
      process.stderr.write(
        `\r[asr] Downloading… ${pct}% (${Math.round(received / 1_048_576)}/${Math.round(total / 1_048_576)} MB)`,
      )
    }
  }
  process.stderr.write('\n')

  const data = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }

  await Bun.write(path, data)
  log(`[asr] Model saved: ${path}`)
  return path
}

// ---------------------------------------------------------------------------
// Whisper addon loader
// ---------------------------------------------------------------------------

/**
 * Resolve the whisper.node addon path.
 *
 * When running from the bundled sidecar tree (production):
 *   <resources>/asr/bun-sidecar/sidecar.ts  ← this file
 *   <resources>/asr/whisper/darwin-arm64/whisper.node
 *
 * When running from node_modules (dev):
 *   Loads directly from the @kutalia package dist/, handling the mac-arm64
 *   naming quirk (package uses "mac-" prefix, not "darwin-").
 */
function loadWhisperAddon(): (
  opts: TranscribeOptions,
) => Promise<TranscribeResult> {
  const sidecardDir = dirname(import.meta.url.replace('file://', ''))
  const nodeArch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const nodePlatform =
    process.platform === 'darwin'
      ? 'darwin'
      : process.platform === 'win32'
        ? 'win32'
        : 'linux'

  // 1. Production: bundled .node next to sidecar
  const prodNodePath = join(
    sidecardDir,
    '..',
    'whisper',
    `${nodePlatform}-${nodeArch}`,
    'whisper.node',
  )
  if (existsSync(prodNodePath)) {
    log(`[asr] Using bundled whisper addon: ${prodNodePath}`)
    return loadNodeAddon(prodNodePath)
  }

  // 2. Dev: load directly from node_modules @kutalia package dist/
  //    The package directories use "mac-" prefix, not "darwin-"
  const pkgPlatform = nodePlatform === 'darwin' ? 'mac' : nodePlatform
  const devNodePaths = [
    // Bun hoists to .bun/
    join(
      sidecardDir,
      '../../node_modules/.bun',
      `@kutalia+whisper-node-addon@1.1.0/node_modules/@kutalia/whisper-node-addon/dist/${pkgPlatform}-${nodeArch}/whisper.node`,
    ),
    // Direct install
    join(
      sidecardDir,
      '../../node_modules/@kutalia/whisper-node-addon/dist',
      `${pkgPlatform}-${nodeArch}`,
      'whisper.node',
    ),
    // From capture package node_modules
    join(
      sidecardDir,
      '../../../node_modules/@kutalia/whisper-node-addon/dist',
      `${pkgPlatform}-${nodeArch}`,
      'whisper.node',
    ),
  ]

  for (const p of devNodePaths) {
    if (existsSync(p)) {
      log(`[asr] Using dev whisper addon: ${p}`)
      return loadNodeAddon(p)
    }
  }

  throw new Error(
    `whisper.node not found. Searched:\n${devNodePaths.join('\n')}\n` +
      `Run: cd packages/browseros-agent && bun add @kutalia/whisper-node-addon --filter @browseros/capture`,
  )
}

function loadNodeAddon(
  addonPath: string,
): (opts: TranscribeOptions) => Promise<TranscribeResult> {
  // On macOS, set DYLD_LIBRARY_PATH so the dynamic linker finds the bundled
  // dylibs next to whisper.node (handles @rpath-baked-at-build-time issues).
  if (process.platform === 'darwin') {
    const dir = dirname(addonPath)
    const existing = process.env.DYLD_LIBRARY_PATH ?? ''
    process.env.DYLD_LIBRARY_PATH = existing ? `${dir}:${existing}` : dir
  }

  const { promisify } = require('node:util') as typeof import('node:util')
  const { whisper } = require(addonPath) as {
    whisper: (
      opts: unknown,
      cb: (err: Error | null, res: unknown) => void,
    ) => void
  }
  const whisperAsync = promisify(whisper)
  return (opts) => whisperAsync(opts) as Promise<TranscribeResult>
}

interface TranscribeOptions {
  model: string
  fname_inp?: string
  pcmf32?: Float32Array
  language?: string
  use_gpu?: boolean
  no_prints?: boolean
  no_timestamps?: boolean
  translate?: boolean
}

interface TranscribeResult {
  transcription?: Array<
    Array<{ text: string; timestamps?: { from: string; to: string } }>
  >
}

// ---------------------------------------------------------------------------
// Audio decoding
// ---------------------------------------------------------------------------

/**
 * Decode a WebM/Opus buffer (from MediaRecorder) to a 16kHz mono Float32Array.
 * Uses @audio/webm-decode (WASM, pure JS, no native deps).
 */
async function decodeWebmToFloat32(data: Uint8Array): Promise<Float32Array> {
  const { decoder } = (await import('@audio/webm-decode')) as {
    decoder: () => Promise<{
      decode(
        data: Uint8Array,
      ): Promise<{ channelData: Float32Array[]; sampleRate: number }>
      flush(): Promise<{ channelData: Float32Array[]; sampleRate: number }>
      free(): void
    }>
  }

  const dec = await decoder()
  try {
    const result1 = await dec.decode(data)
    const result2 = await dec.flush()

    // Merge decode + flush results
    const combined = [result1, result2].flatMap((r) =>
      r.channelData[0] ? [r.channelData[0]] : [],
    )

    if (combined.length === 0) return new Float32Array(0)

    // Concatenate all float samples from the first (mono) channel
    const totalLen = combined.reduce((s, a) => s + a.length, 0)
    const merged = new Float32Array(totalLen)
    let off = 0
    for (const arr of combined) {
      merged.set(arr, off)
      off += arr.length
    }

    // Resample to 16kHz if the audio came in at a different rate
    // (MediaRecorder on macOS often uses 48kHz)
    const srcRate = combined[0] ? (result1.sampleRate ?? 48000) : 48000
    if (srcRate === 16000) return merged
    return resampleLinear(merged, srcRate, 16000)
  } finally {
    dec.free()
  }
}

function resampleLinear(
  src: Float32Array,
  srcRate: number,
  dstRate: number,
): Float32Array {
  const ratio = srcRate / dstRate
  const outLen = Math.floor(src.length / ratio)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const lo = Math.floor(pos)
    const hi = Math.min(lo + 1, src.length - 1)
    const frac = pos - lo
    out[i] = (src[lo] ?? 0) * (1 - frac) + (src[hi] ?? 0) * frac
  }
  return out
}

// ---------------------------------------------------------------------------
// JSONL I/O helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  process.stderr.write(`${msg}\n`)
}

function emit(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function emitAck(sequence: number): void {
  emit({ kind: 'ack', sequence })
}

// ---------------------------------------------------------------------------
// Mock transcription (BROWSEROS_ASR_MOCK=1)
// ---------------------------------------------------------------------------

function mockTranscribe(chunk: AudioChunkMsg): void {
  const { sequence, sessionId, capturedAt } = chunk
  emit({
    kind: 'partial',
    id: randomUUID(),
    sessionId,
    text: `[chunk ${sequence}] meeting audio received`,
    capturedAt,
    startedAtMs: capturedAt,
    endedAtMs: capturedAt + 1000,
  })
  emit({
    kind: 'final',
    id: randomUUID(),
    sessionId,
    text: `[chunk ${sequence}] meeting audio received`,
    capturedAt: capturedAt + 4000,
    startedAtMs: capturedAt,
    endedAtMs: capturedAt + 4000,
  })
  emitAck(sequence)
}

// ---------------------------------------------------------------------------
// Main transcription loop
// ---------------------------------------------------------------------------

interface AudioChunkMsg {
  sessionId: string
  sequence: number
  mimeType: string
  capturedAt: number
  dataBase64: string
}

async function main(): Promise<void> {
  if (MOCK_MODE) {
    log('[asr] Mock mode enabled')
    const rl = createInterface({ input: process.stdin })
    for await (const line of rl) {
      if (!line.trim()) continue
      const chunk = JSON.parse(line) as AudioChunkMsg
      mockTranscribe(chunk)
    }
    return
  }

  log('[asr] Initializing Whisper sidecar (bun/native)')
  const [modelPath, transcribe] = await Promise.all([
    ensureModel(),
    Promise.resolve(loadWhisperAddon()),
  ])
  log(`[asr] Model ready: ${modelPath}`)

  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    if (!line.trim()) continue
    const chunk = JSON.parse(line) as AudioChunkMsg
    const { sequence, sessionId, capturedAt } = chunk

    try {
      const rawBytes = Buffer.from(chunk.dataBase64, 'base64')
      const pcmf32 = await decodeWebmToFloat32(new Uint8Array(rawBytes))

      if (pcmf32.length < 3200) {
        // Less than 200ms at 16kHz — not enough audio, skip silently
        emitAck(sequence)
        continue
      }

      const result = await transcribe({
        model: modelPath,
        pcmf32,
        language: 'en',
        use_gpu: true,
        no_prints: true,
        no_timestamps: false,
        translate: false,
      })

      const text = (result.transcription ?? [])
        .flat()
        .map((s) => (typeof s === 'string' ? s : (s.text ?? '')).trim())
        .filter(Boolean)
        .join(' ')
        .trim()

      if (text) {
        emit({
          kind: 'final',
          id: randomUUID(),
          sessionId,
          text,
          capturedAt,
        })
      }
    } catch (err) {
      log(`[asr] Error processing chunk ${sequence}: ${err}`)
    } finally {
      emitAck(sequence)
    }
  }
}

main().catch((err) => {
  process.stderr.write(`[asr] Fatal: ${err}\n`)
  process.exit(1)
})
