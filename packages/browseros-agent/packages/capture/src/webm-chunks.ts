/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * MediaRecorder timeslice WebM: chunk 0 has the EBML header; later chunks are
 * cluster continuations. Concatenate in order for a decodable file.
 */

/** Merge ordered MediaRecorder timeslice blobs into one WebM byte stream. */
export function concatWebmTimesliceChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}
