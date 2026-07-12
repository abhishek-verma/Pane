/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { LocalFasterWhisperProvider } from '@browseros/capture/providers'

describe('capture providers', () => {
  it('mock sidecar emits final transcript segments', async () => {
    const provider = new LocalFasterWhisperProvider({
      command: 'python3',
      args: [
        join(
          import.meta.dir,
          '../../../../packages/capture/asr/browseros_capture_asr/__main__.py',
        ),
        '--mock',
      ],
    })
    const finals: string[] = []
    const session = await provider.startSession({
      sessionId: 'sess-1',
      onPartial: () => {},
      onFinal: (segment) => finals.push(segment.text),
    })
    await session.feedChunk({
      sessionId: 'sess-1',
      sequence: 1,
      mimeType: 'audio/webm',
      data: new TextEncoder().encode('audio'),
      capturedAt: Date.now(),
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    await session.stop()
    expect(finals.some((text) => text.includes('chunk 1'))).toBe(true)
  })
})
