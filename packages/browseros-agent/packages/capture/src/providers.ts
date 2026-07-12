/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
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

function defaultSidecarArgs(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const asrRoot = join(moduleDir, '..', 'asr')
  const mock = process.env.BROWSEROS_ASR_MOCK === '1'
  if (mock) {
    return [join(asrRoot, 'browseros_capture_asr', '__main__.py'), '--mock']
  }
  return [
    '-m',
    'browseros_capture_asr',
    '--model',
    process.env.BROWSEROS_ASR_MODEL ?? 'small.en',
  ]
}

function sidecarEnv(): NodeJS.ProcessEnv {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const asrRoot = join(moduleDir, '..', 'asr')
  return {
    ...process.env,
    PYTHONPATH: [asrRoot, process.env.PYTHONPATH].filter(Boolean).join(':'),
    BROWSEROS_ASR_MOCK: process.env.BROWSEROS_ASR_MOCK ?? '',
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
    const command =
      this.options.command ?? process.env.BROWSEROS_ASR_SIDECAR ?? 'python3'
    const args = this.options.args ?? defaultSidecarArgs()
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
    child.stderr.on('data', () => {
      // sidecar logs on stderr; ignore for transcript path
    })
  }

  async feedChunk(chunk: AudioChunk): Promise<void> {
    const payload = JSON.stringify({
      sessionId: chunk.sessionId,
      sequence: chunk.sequence,
      mimeType: chunk.mimeType,
      capturedAt: chunk.capturedAt,
      dataBase64: Buffer.from(chunk.data).toString('base64'),
    })
    if (!this.child.stdin.write(`${payload}\n`)) {
      await new Promise<void>((resolve) =>
        this.child.stdin.once('drain', resolve),
      )
    }
  }

  async stop(): Promise<void> {
    this.child.stdin.end()
    await new Promise<void>((resolve) => {
      this.child.once('close', () => resolve())
      setTimeout(resolve, 2_000)
    })
  }

  private handleStdout(data: string): void {
    for (const line of data.split('\n')) {
      if (!line.trim()) continue
      const parsed = JSON.parse(line) as Partial<TranscriptSegment>
      const segment: TranscriptSegment = {
        id: parsed.id ?? crypto.randomUUID(),
        sessionId: parsed.sessionId ?? this.input.sessionId,
        kind: parsed.kind === 'final' ? 'final' : 'partial',
        text: String(parsed.text ?? ''),
        startedAtMs: parsed.startedAtMs,
        endedAtMs: parsed.endedAtMs,
        capturedAt: parsed.capturedAt ?? Date.now(),
        speaker: parsed.speaker,
      }
      if (segment.kind === 'final') {
        this.input.onFinal(segment)
      } else {
        this.input.onPartial(segment)
      }
    }
  }
}
