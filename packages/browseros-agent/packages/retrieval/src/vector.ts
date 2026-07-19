/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Vector helpers for local embedding blobs (sqlite-vec-compatible layout).
 * Brute-force cosine is used when a native ANN extension is unavailable.
 */

import { EMBED_DIMS } from './constants'

/** Pack a Float32Array into a Buffer for SQLite BLOB storage. */
export function packEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
}

/** Unpack a SQLite BLOB into a Float32Array. */
export function unpackEmbedding(blob: Buffer | Uint8Array): Float32Array {
  const buf = blob instanceof Buffer ? blob : Buffer.from(blob)
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function zeroVector(dims = EMBED_DIMS): Float32Array {
  return new Float32Array(dims)
}

/** L2-normalize in place. */
export function l2Normalize(vec: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i] ?? 0
    sum += v * v
  }
  const norm = Math.sqrt(sum)
  if (norm === 0) return vec
  for (let i = 0; i < vec.length; i++) {
    vec[i] = (vec[i] ?? 0) / norm
  }
  return vec
}
