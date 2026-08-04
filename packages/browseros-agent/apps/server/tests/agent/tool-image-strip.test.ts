import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ContentBlock } from '@browseros/browser-mcp/tools/framework'
import { ToolImageStore } from '../../src/agent/session-store'
import { toBrowserToolExecuteResult } from '../../src/agent/tool-adapter'
import {
  rehydrateImagesForModel,
  stripAndStoreImages,
} from '../../src/agent/tool-image-strip'
import { closeDb, initializeDb } from '../../src/lib/db'

class MockImageStore {
  stored: Array<{
    sessionId: string
    toolCallId: string
    data: string
    mimeType: string
  }> = []
  byId = new Map<string, { data: Buffer; mimeType: string }>()

  store(
    sessionId: string,
    toolCallId: string,
    data: string,
    mimeType: string,
  ): boolean {
    this.stored.push({ sessionId, toolCallId, data, mimeType })
    this.byId.set(toolCallId, {
      data: Buffer.from(data, 'base64'),
      mimeType,
    })
    return true
  }

  get(toolCallId: string): { data: Buffer; mimeType: string } | null {
    return this.byId.get(toolCallId) ?? null
  }
}

describe('stripAndStoreImages / toBrowserToolExecuteResult', () => {
  it('stores blobs and returns stripped UI content without data', () => {
    const store = new MockImageStore()
    const content: ContentBlock[] = [
      { type: 'text', text: '[Page 1 diff]\n- e1\n+ e2' },
      { type: 'image', data: 'QUJDRA==', mimeType: 'image/jpeg' },
    ]

    const result = toBrowserToolExecuteResult(
      { content, isError: false },
      {
        sessionId: 'sess-1',
        toolCallId: 'call-1',
        imageStore: store as never,
      },
    )

    expect(store.stored).toHaveLength(1)
    expect(store.stored[0]?.toolCallId).toBe('call-1')
    const img = result.content.find((c) => c.type === 'image') as {
      stripped?: boolean
      data?: string
      mimeType: string
    }
    expect(img.stripped).toBe(true)
    expect(img.data).toBeUndefined()
    expect(img.mimeType).toBe('image/jpeg')
    // Page-diff text preserved
    expect(
      result.content.some(
        (c) => c.type === 'text' && c.text.includes('[Page 1 diff]'),
      ),
    ).toBe(true)
  })

  it('leaves text-only results unchanged', () => {
    const store = new MockImageStore()
    const content: ContentBlock[] = [{ type: 'text', text: 'ok (click)' }]
    const next = stripAndStoreImages(content, {
      sessionId: 's',
      toolCallId: 't',
      imageStore: store as never,
    })
    expect(next).toBe(content)
    expect(store.stored).toHaveLength(0)
  })
})

describe('sequential stills (T4)', () => {
  it('10 act stills → zero inline data, store count = 10', () => {
    const store = new MockImageStore()
    const results = Array.from({ length: 10 }, (_, i) =>
      toBrowserToolExecuteResult(
        {
          content: [
            { type: 'text', text: `[Page 1 diff]\nref=e${i}` },
            {
              type: 'image',
              data: Buffer.from(`frame-${i}`).toString('base64'),
              mimeType: 'image/jpeg',
            },
          ],
          isError: false,
        },
        {
          sessionId: 'sess',
          toolCallId: `call-${i}`,
          imageStore: store as never,
        },
      ),
    )

    expect(store.stored).toHaveLength(10)
    for (const result of results) {
      for (const item of result.content) {
        if (item.type === 'image') {
          expect((item as { stripped?: boolean }).stripped).toBe(true)
          expect((item as { data?: string }).data).toBeUndefined()
        }
      }
      expect(
        result.content.some(
          (c) => c.type === 'text' && c.text.includes('[Page 1 diff]'),
        ),
      ).toBe(true)
    }
  })
})

describe('rehydrateImagesForModel', () => {
  it('returns media bytes for a just-stored image', () => {
    const store = new MockImageStore()
    store.store('sess', 'call-1', 'QUJDRA==', 'image/jpeg')
    const content: ContentBlock[] = [
      { type: 'text', text: 'done' },
      { type: 'image', mimeType: 'image/jpeg', stripped: true },
    ]

    const rehydrated = rehydrateImagesForModel(content, {
      toolCallId: 'call-1',
      imageStore: store as never,
    })

    const img = rehydrated.find((c) => c.type === 'image') as {
      data?: string
      mimeType: string
    }
    expect(img.data).toBe('QUJDRA==')
    expect(img.mimeType).toBe('image/jpeg')
  })

  it('omits missing images on store miss (keeps surrounding text)', () => {
    const store = new MockImageStore()
    const content: ContentBlock[] = [
      { type: 'text', text: '[Page 1 diff]\n+ button' },
      { type: 'image', mimeType: 'image/png', stripped: true },
    ]
    const rehydrated = rehydrateImagesForModel(content, {
      toolCallId: 'missing',
      imageStore: store as never,
    })
    expect(rehydrated).toEqual([
      { type: 'text', text: '[Page 1 diff]\n+ button' },
    ])
  })

  it('omits image blocks when persistence fails', () => {
    const store = new MockImageStore()
    store.store = () => false
    const content: ContentBlock[] = [
      { type: 'text', text: 'ok' },
      { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' },
    ]
    const next = stripAndStoreImages(content, {
      sessionId: 's',
      toolCallId: 't',
      imageStore: store as never,
    })
    expect(next).toEqual([{ type: 'text', text: 'ok' }])
  })
})

describe('rehydrateImagesForModel with a real ToolImageStore (bun:sqlite)', () => {
  // MockImageStore above stores/returns genuine Buffers and never exercised
  // the real store: bun:sqlite hands BLOB columns back as a plain
  // Uint8Array, and rehydrateImagesForModel calls `stored.data.toString
  // ('base64')` directly. Uint8Array#toString() ignores the 'base64'
  // argument and joins bytes as comma-separated decimals — producing a
  // string that is 3-4x too long and not valid base64, which is exactly
  // what made Bedrock reject the request with SerializationException.
  // This test exercises the real store end-to-end so that regression can't
  // hide behind a mock again.
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browseros-tool-image-strip-'))
    initializeDb({ dbPath: join(tmpDir, 'test.db'), runMigrations: true })
  })

  afterEach(() => {
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('produces valid, correctly-sized base64 for the model after a DB round-trip', () => {
    const store = new ToolImageStore()
    // Every byte value 0-255 at least once, so a comma-decimal encoding
    // bug (which is byte-value-length dependent) can't hide by luck.
    const jpegLikeBytes = Buffer.from(
      Array.from({ length: 256 * 8 }, (_, i) => i % 256),
    )
    const expectedBase64 = jpegLikeBytes.toString('base64')
    store.store('sess-1', 'call-1', expectedBase64, 'image/jpeg')

    const content: ContentBlock[] = [
      { type: 'text', text: '[Page 5 screenshot]' },
      { type: 'image', mimeType: 'image/jpeg', stripped: true },
    ]
    const rehydrated = rehydrateImagesForModel(content, {
      toolCallId: 'call-1',
      imageStore: store,
    })

    const img = rehydrated.find((c) => c.type === 'image') as {
      data?: string
      mimeType: string
    }
    expect(img.data).toBe(expectedBase64)
    // Valid base64 alphabet only — no commas, no decimal-byte artifacts.
    expect(img.data).toMatch(/^[A-Za-z0-9+/]*={0,2}$/)
    expect(Buffer.from(img.data ?? '', 'base64').equals(jpegLikeBytes)).toBe(
      true,
    )
  })
})
