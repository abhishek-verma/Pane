/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  AudioChunk,
  TranscriptionProvider,
  TranscriptionSession,
  TranscriptSegment,
} from './types'

interface LocalFasterWhisperOptions {
  command?: string
  args?: string[]
}

/**
 * Resolve the runtime (Bun binary) and script for the ASR sidecar.
 *
 * Priority:
 *  1. BROWSEROS_ASR_SIDECAR env var — used in dev/CI to set the runtime directly
 *     (set to the full bun/python command; BROWSEROS_ASR_SIDECAR_SCRIPT overrides the script).
 *  2. Bundled Bun + bundled TS sidecar (production path inside the app bundle).
 *  3. dev workspace: use system `bun` + local sidecar.ts from source.
 */
export function resolveLocalAsrSidecar(): { command: string; args: string[] } {
  return resolveSidecar()
}

export function localAsrSidecarEnv(): NodeJS.ProcessEnv {
  return sidecarEnv()
}

function resolveSidecar(): { command: string; args: string[] } {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const mock = process.env.BROWSEROS_ASR_MOCK === '1'
  const bunName = process.platform === 'win32' ? 'bun.exe' : 'bun'

  // Explicit override (dev / CI / power-user)
  if (process.env.BROWSEROS_ASR_SIDECAR) {
    const pythonOrBun = process.env.BROWSEROS_ASR_SIDECAR
    // Legacy Python-style override: just a python binary path → keep old args
    if (pythonOrBun.includes('python')) {
      const asrRoot = join(moduleDir, '..', 'asr')
      return {
        command: pythonOrBun,
        args: mock
          ? [join(asrRoot, 'browseros_capture_asr', '__main__.py'), '--mock']
          : [
              '-m',
              'browseros_capture_asr',
              '--model',
              process.env.BROWSEROS_ASR_MODEL ?? 'small.en',
            ],
      }
    }
    // Bun-style override: binary + optional script override
    const script =
      process.env.BROWSEROS_ASR_SIDECAR_SCRIPT ??
      firstExisting([
        join(
          dirname(process.execPath),
          '..',
          'asr',
          'bun-sidecar',
          'sidecar.ts',
        ),
        join(moduleDir, '..', 'asr', 'bun-sidecar', 'sidecar.ts'),
      ]) ??
      join(moduleDir, '..', 'asr', 'bun-sidecar', 'sidecar.ts')
    return { command: pythonOrBun, args: [script] }
  }

  // Production compiled binary: browseros_server lives at resources/bin/,
  // with bun at bin/third_party/bun and the sidecar under resources/asr/.
  // import.meta.url points inside the bun compile FS, so existsSync on a
  // moduleDir-relative path always misses — resolve from execPath first.
  const execDir = dirname(process.execPath)
  const nextToBinary = join(execDir, 'third_party', bunName)
  const scriptNextToBinary = join(
    execDir,
    '..',
    'asr',
    'bun-sidecar',
    'sidecar.ts',
  )
  if (existsSync(nextToBinary) && existsSync(scriptNextToBinary)) {
    return { command: nextToBinary, args: [scriptNextToBinary] }
  }

  // resourcesDir from env (Pane server_config / BROWSEROS_RESOURCES_DIR)
  const resourcesDir = process.env.BROWSEROS_RESOURCES_DIR?.trim()
  if (resourcesDir) {
    const fromResources = join(resourcesDir, 'bin', 'third_party', bunName)
    const scriptFromResources = join(
      resourcesDir,
      'asr',
      'bun-sidecar',
      'sidecar.ts',
    )
    if (existsSync(fromResources) && existsSync(scriptFromResources)) {
      return { command: fromResources, args: [scriptFromResources] }
    }
  }

  // Uncompiled package layout (dev workspace / tests)
  const bundledBun = join(moduleDir, '..', 'bin', 'third_party', bunName)
  if (existsSync(bundledBun)) {
    const script = join(moduleDir, '..', 'asr', 'bun-sidecar', 'sidecar.ts')
    return { command: bundledBun, args: [script] }
  }

  // Dev workspace: system bun + source sidecar
  const devScript = join(moduleDir, '..', 'asr', 'bun-sidecar', 'sidecar.ts')
  return { command: 'bun', args: [devScript] }
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path))
}

function sidecarEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    BROWSEROS_ASR_MOCK: process.env.BROWSEROS_ASR_MOCK ?? '',
    BROWSEROS_ASR_MODEL: process.env.BROWSEROS_ASR_MODEL ?? 'ggml-small.en',
  }
}

export class LocalFasterWhisperProvider implements TranscriptionProvider {
  readonly id = 'local-faster-whisper' as const

  constructor(private readonly options: LocalFasterWhisperOptions = {}) {}

  async startSession(input: {
    sessionId: string
    onPartial: (segment: TranscriptSegment) => void
    onFinal: (segment: TranscriptSegment) => void
  }): Promise<TranscriptionSession> {
    const { command, args } = this.options.command
      ? { command: this.options.command, args: this.options.args ?? [] }
      : resolveSidecar()
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: sidecarEnv(),
    })
    return new JsonlSidecarSession(child, input)
  }
}

export class ByokTranscriptionProvider implements TranscriptionProvider {
  readonly id: 'openai-byok' | 'deepgram-byok'
  private readonly apiKey: string

  constructor(id: 'openai-byok' | 'deepgram-byok', apiKey: string) {
    this.id = id
    this.apiKey = apiKey
  }

  async startSession(input: {
    sessionId: string
    onPartial: (segment: TranscriptSegment) => void
    onFinal: (segment: TranscriptSegment) => void
  }): Promise<TranscriptionSession> {
    return new ByokTranscriptionSession(this.id, this.apiKey, input)
  }
}

class ByokTranscriptionSession implements TranscriptionSession {
  constructor(
    private readonly providerId: 'openai-byok' | 'deepgram-byok',
    private readonly apiKey: string,
    private readonly input: {
      sessionId: string
      onPartial: (segment: TranscriptSegment) => void
      onFinal: (segment: TranscriptSegment) => void
    },
  ) {}

  async feedChunk(chunk: AudioChunk): Promise<void> {
    const text = await transcribeChunk(this.providerId, this.apiKey, chunk)
    if (!text) return
    const capturedAt = chunk.capturedAt ?? Date.now()
    const segment: TranscriptSegment = {
      id: crypto.randomUUID(),
      sessionId: this.input.sessionId,
      kind: 'final',
      text,
      capturedAt,
    }
    this.input.onPartial(segment)
    this.input.onFinal(segment)
  }

  async stop(): Promise<void> {
    // no persistent connection for BYOK batch chunks
  }
}

async function transcribeChunk(
  providerId: 'openai-byok' | 'deepgram-byok',
  apiKey: string,
  chunk: AudioChunk,
): Promise<string> {
  if (providerId === 'openai-byok') {
    const body = new FormData()
    body.append(
      'file',
      new Blob([Buffer.from(chunk.data)], { type: chunk.mimeType }),
      `chunk-${chunk.sequence}.webm`,
    )
    body.append('model', 'whisper-1')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    })
    if (!res.ok) {
      throw new Error(`OpenAI transcription failed (${res.status})`)
    }
    const json = (await res.json()) as { text?: string }
    return String(json.text ?? '').trim()
  }

  const res = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': chunk.mimeType,
      },
      body: Buffer.from(chunk.data),
    },
  )
  if (!res.ok) {
    throw new Error(`Deepgram transcription failed (${res.status})`)
  }
  const json = (await res.json()) as {
    results?: {
      channels?: Array<{ alternatives?: Array<{ transcript?: string }> }>
    }
  }
  return (
    json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
  )
}

class JsonlSidecarSession implements TranscriptionSession {
  private stdoutBuffer = ''
  private pendingAck: (() => void) | null = null
  private pendingAckReject: ((err: Error) => void) | null = null
  private pendingAckTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly input: {
      sessionId: string
      onPartial: (segment: TranscriptSegment) => void
      onFinal: (segment: TranscriptSegment) => void
    },
  ) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (data) => this.handleStdout(String(data)))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (data) => {
      // Surface sidecar stderr to the server log so startup failures are visible.
      // Never throw — a broken stderr pipe must not take down the agent server.
      try {
        process.stderr.write(`[asr-sidecar] ${String(data)}`)
      } catch {
        // ignore
      }
    })
    // Writing to a closed stdin (sidecar crashed) emits 'error'; without a
    // listener Node/Bun can terminate the parent process — that crash-looped
    // Pane during live meetings.
    child.stdin.on('error', (err) => {
      this.rejectPendingAck(err instanceof Error ? err : new Error(String(err)))
    })
    child.on('error', (err) => {
      this.rejectPendingAck(err instanceof Error ? err : new Error(String(err)))
    })
    // Reject the pending ack immediately if the sidecar exits unexpectedly
    child.on('exit', (code) => {
      if (code !== 0) {
        this.rejectPendingAck(new Error(`ASR sidecar exited with code ${code}`))
      }
    })
  }

  private rejectPendingAck(err: Error): void {
    if (!this.pendingAckReject) return
    if (this.pendingAckTimer) {
      clearTimeout(this.pendingAckTimer)
      this.pendingAckTimer = null
    }
    const reject = this.pendingAckReject
    this.pendingAck = null
    this.pendingAckReject = null
    reject(err)
  }

  async feedChunk(chunk: AudioChunk): Promise<void> {
    if (this.child.killed || this.child.exitCode !== null) {
      throw new Error('ASR sidecar is not running')
    }
    await new Promise<void>((resolve, reject) => {
      if (this.pendingAck) {
        reject(new Error('ASR sidecar is already processing a chunk'))
        return
      }
      this.pendingAck = resolve
      this.pendingAckReject = reject
      this.pendingAckTimer = setTimeout(() => {
        this.pendingAck = null
        this.pendingAckReject = null
        this.pendingAckTimer = null
        reject(new Error(`ASR sidecar ack timeout for chunk ${chunk.sequence}`))
      }, 120_000)

      const payload = JSON.stringify({
        sessionId: chunk.sessionId,
        sequence: chunk.sequence,
        mimeType: chunk.mimeType,
        capturedAt: chunk.capturedAt,
        dataBase64: Buffer.from(chunk.data).toString('base64'),
      })
      try {
        const writeOk = this.child.stdin.write(`${payload}\n`)
        if (!writeOk) {
          this.child.stdin.once('drain', () => undefined)
        }
      } catch (err) {
        this.rejectPendingAck(
          err instanceof Error ? err : new Error(String(err)),
        )
      }
    })
  }

  private resolveAck(): void {
    if (this.pendingAckTimer) {
      clearTimeout(this.pendingAckTimer)
      this.pendingAckTimer = null
    }
    const resolve = this.pendingAck
    this.pendingAck = null
    this.pendingAckReject = null
    resolve?.()
  }

  async stop(): Promise<void> {
    this.child.stdin.end()
    await new Promise<void>((resolve) => {
      this.child.once('close', () => resolve())
      setTimeout(resolve, 2_000)
    })
  }

  private handleStdout(data: string): void {
    this.stdoutBuffer += data
    const lines = this.stdoutBuffer.split('\n')
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (parsed.kind === 'ack') {
        this.resolveAck()
        continue
      }
      const segment: TranscriptSegment = {
        id: String(parsed.id ?? crypto.randomUUID()),
        sessionId: String(parsed.sessionId ?? this.input.sessionId),
        kind: parsed.kind === 'final' ? 'final' : 'partial',
        text: String(parsed.text ?? ''),
        startedAtMs:
          typeof parsed.startedAtMs === 'number'
            ? parsed.startedAtMs
            : undefined,
        endedAtMs:
          typeof parsed.endedAtMs === 'number' ? parsed.endedAtMs : undefined,
        capturedAt:
          typeof parsed.capturedAt === 'number'
            ? parsed.capturedAt
            : Date.now(),
        speaker:
          typeof parsed.speaker === 'string' ? parsed.speaker : undefined,
      }
      if (segment.kind === 'final') {
        this.input.onFinal(segment)
      } else {
        this.input.onPartial(segment)
      }
    }
  }
}
