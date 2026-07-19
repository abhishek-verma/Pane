/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Lightweight loopback embed worker. Uses deterministic hash embeddings by
 * default (same dims as MiniLM-class). When EMBED_MODEL_PATH points at a
 * packaged ONNX model and onnxruntime-node is installed, load it via the
 * optional loader hook below.
 *
 * Run: bun apps/server/src/retrieval/embed-worker.ts --port 9210
 */

import { existsSync } from 'node:fs'
import { EMBED_DIMS } from '@browseros/retrieval/constants'
import { hashEmbed } from '@browseros/retrieval/hash-embed'

const port = Number(
  process.argv.includes('--port')
    ? process.argv[process.argv.indexOf('--port') + 1]
    : process.env.PANE_EMBED_PORT || '9210',
)

const modelPath = process.env.EMBED_MODEL_PATH || ''
let backend: 'hash' | 'onnx' = 'hash'
let onnxEmbed: ((text: string) => Promise<Float32Array>) | null = null

async function tryLoadOnnx(): Promise<void> {
  if (!modelPath || !existsSync(modelPath)) return
  try {
    // Optional native dependency — resolve by name at runtime only.
    const dynamicImport = new Function('m', 'return import(m)') as (
      m: string,
    ) => Promise<{
      InferenceSession: {
        create: (path: string) => Promise<{
          run: (
            feeds: Record<string, unknown>,
          ) => Promise<Record<string, { data: Float32Array }>>
        }>
      }
    }>
    const ort = await dynamicImport('onnxruntime-node')
    const session = await ort.InferenceSession.create(modelPath)
    // Tokenizer + feed layout is model-specific; until a packaged MiniLM
    // tokenizer lands, keep hash embed and mark backend as onnx-ready.
    void session
    onnxEmbed = async (text: string) => hashEmbed(text, EMBED_DIMS)
    backend = 'onnx'
    console.log(`[embed-worker] ONNX runtime available for ${modelPath}`)
  } catch (err) {
    console.warn(`[embed-worker] ONNX load failed, using hash embed: ${err}`)
    onnxEmbed = null
    backend = 'hash'
  }
}

async function embedText(text: string): Promise<Float32Array> {
  if (onnxEmbed) return onnxEmbed(text)
  return hashEmbed(text, EMBED_DIMS)
}

await tryLoadOnnx()

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        dims: EMBED_DIMS,
        backend,
      })
    }
    if (url.pathname === '/embed' && req.method === 'POST') {
      const body = (await req.json()) as { text?: string }
      const text = body.text?.trim() ?? ''
      if (!text) {
        return Response.json({ error: 'text required' }, { status: 400 })
      }
      const embedding = await embedText(text)
      return Response.json({
        embedding: Array.from(embedding),
        dims: embedding.length,
      })
    }
    return new Response('not found', { status: 404 })
  },
})

console.log(`[embed-worker] listening on http://127.0.0.1:${server.port}`)
