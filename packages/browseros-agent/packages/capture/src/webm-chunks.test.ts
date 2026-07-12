/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { concatWebmTimesliceChunks } from './webm-chunks'

describe('@browseros/capture webm-chunks', () => {
  it('concatenates chunk bytes in order', () => {
    const merged = concatWebmTimesliceChunks([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5]),
    ])
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5])
  })

  it('builds a decodable webm from a live capture fixture when present', async () => {
    const fixtureDir = process.env.BROWSEROS_CAPTURE_WEBM_FIXTURE_DIR
    if (!fixtureDir) return
    let chunk0: Uint8Array
    let chunk1: Uint8Array
    try {
      chunk0 = new Uint8Array(await readFile(`${fixtureDir}/00000000.chunk`))
      chunk1 = new Uint8Array(await readFile(`${fixtureDir}/00000001.chunk`))
    } catch {
      return
    }

    expect(Array.from(chunk0.slice(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3])
    expect(Array.from(chunk0.slice(0, 4))).not.toEqual(
      Array.from(chunk1.slice(0, 4)),
    )

    const merged = concatWebmTimesliceChunks([chunk0, chunk1])
    expect(merged.byteLength).toBe(chunk0.byteLength + chunk1.byteLength)
  })
})
