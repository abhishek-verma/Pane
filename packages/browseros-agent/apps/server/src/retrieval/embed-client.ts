/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Embed client: prefers loopback embed worker; falls back to in-process
 * hash embeddings so hybrid search always has a semantic arm.
 */

import { EMBED_QUERY_TIMEOUT_MS } from '@browseros/retrieval/constants'
import { hashEmbed } from '@browseros/retrieval/hash-embed'
import type { EmbedClient } from '@browseros/retrieval/types'
import { logger } from '../lib/logger'

let workerBaseUrl: string | null = null
let workerHealthy = false

export function setEmbedWorkerUrl(url: string | null): void {
  workerBaseUrl = url
  workerHealthy = !!url
}

export function getEmbedWorkerUrl(): string | null {
  return workerBaseUrl
}

async function embedViaWorker(
  text: string,
  timeoutMs: number,
): Promise<Float32Array | null> {
  if (!workerBaseUrl) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${workerBaseUrl}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    if (!res.ok) {
      workerHealthy = false
      return null
    }
    const body = (await res.json()) as { embedding?: number[] }
    if (!body.embedding?.length) return null
    workerHealthy = true
    return Float32Array.from(body.embedding)
  } catch (err) {
    workerHealthy = false
    logger.debug('embed worker request failed', { err: String(err) })
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Local embed client used by hybrid retrieve. */
export function createEmbedClient(options?: {
  /** When true, never call the worker (tests / lexical-only). */
  forceHash?: boolean
}): EmbedClient {
  return {
    available: () => true,
    embed: async (text, timeoutMs = EMBED_QUERY_TIMEOUT_MS) => {
      if (!text.trim()) return null
      if (!options?.forceHash && workerBaseUrl && workerHealthy !== false) {
        const viaWorker = await embedViaWorker(text, timeoutMs)
        if (viaWorker) return viaWorker
      }
      // In-process hash fallback — always available, dims match MiniLM-class.
      return hashEmbed(text)
    },
  }
}

export async function pingEmbedWorker(): Promise<boolean> {
  if (!workerBaseUrl) return false
  try {
    const res = await fetch(`${workerBaseUrl}/health`, {
      signal: AbortSignal.timeout(500),
    })
    workerHealthy = res.ok
    return res.ok
  } catch {
    workerHealthy = false
    return false
  }
}
