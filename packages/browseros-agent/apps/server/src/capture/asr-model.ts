/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Server-side helper for the local Whisper ASR model.
 *
 * The model is downloaded once and cached at a platform-standard path.
 * These helpers let the server check status and initiate a download on
 * behalf of the settings UI — so the user sees progress when they first
 * enable meeting capture, rather than discovering a silent delay mid-call.
 */

import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../lib/logger'

const DEFAULT_MODEL_NAME = 'ggml-small.en'
const HUGGINGFACE_BASE =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

export interface AsrModelStatus {
  modelName: string
  status: 'ready' | 'not_downloaded'
  modelPath: string
  fileSizeBytes?: number
}

export interface AsrDownloadProgress {
  modelName: string
  receivedBytes: number
  totalBytes: number
  percent: number
}

/** Directory where ASR models are cached on disk. */
function modelDir(): string {
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Pane', 'asr-models')
      : join(homedir(), '.local', 'share', 'Pane', 'asr-models')
  mkdirSync(base, { recursive: true })
  return base
}

/** Canonical path for a given model bin file. */
export function modelPath(modelName = DEFAULT_MODEL_NAME): string {
  return join(modelDir(), `${modelName}.bin`)
}

/** Synchronous check — does the model file exist on disk? */
export async function getAsrModelStatus(
  modelName = DEFAULT_MODEL_NAME,
): Promise<AsrModelStatus> {
  const path = modelPath(modelName)
  if (!existsSync(path)) {
    return { modelName, status: 'not_downloaded', modelPath: path }
  }
  const info = await stat(path)
  return {
    modelName,
    status: 'ready',
    modelPath: path,
    fileSizeBytes: info.size,
  }
}

/**
 * Download the model from HuggingFace, calling `onProgress` as bytes arrive.
 * Resolves with the model path on success.
 * Rejects if a download is already in progress or the fetch fails.
 */
let activeDownload: Promise<string> | null = null

export async function ensureAsrModel(
  onProgress: (p: AsrDownloadProgress) => void,
  modelName = DEFAULT_MODEL_NAME,
): Promise<string> {
  const path = modelPath(modelName)

  if (existsSync(path)) {
    const info = await stat(path)
    onProgress({
      modelName,
      receivedBytes: info.size,
      totalBytes: info.size,
      percent: 100,
    })
    return path
  }

  // Reuse an in-flight download if one is already running
  if (activeDownload) {
    return activeDownload
  }

  activeDownload = (async () => {
    const url = `${HUGGINGFACE_BASE}/${modelName}.bin`
    logger.info(`[asr-model] Downloading ${modelName} from ${url}`)

    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(
        `Model download failed: ${res.status} ${res.statusText} — ${url}`,
      )
    }

    const total = Number(res.headers.get('content-length') ?? 0)
    if (!res.body) throw new Error('Download response had no body')

    const tmpPath = `${path}.tmp`
    const writer = createWriteStream(tmpPath)
    const reader = res.body.getReader()
    let received = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        writer.write(value)
        received += value.length
        onProgress({
          modelName,
          receivedBytes: received,
          totalBytes: total,
          percent: total > 0 ? Math.round((received / total) * 100) : 0,
        })
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        writer.end((err?: Error | null) => (err ? reject(err) : resolve()))
      })
    }

    // Atomic rename: replace .tmp with final path
    const { rename } = await import('node:fs/promises')
    await rename(tmpPath, path)
    logger.info(`[asr-model] Model saved to ${path}`)
    return path
  })().finally(() => {
    activeDownload = null
  })

  return activeDownload
}
