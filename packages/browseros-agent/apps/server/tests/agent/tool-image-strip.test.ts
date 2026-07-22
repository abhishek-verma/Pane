import { describe, expect, it } from 'bun:test'
import type { ContentBlock } from '@browseros/browser-mcp/tools/framework'
import { toBrowserToolExecuteResult } from '../../src/agent/tool-adapter'
import {
  rehydrateImagesForModel,
  stripAndStoreImages,
} from '../../src/agent/tool-image-strip'

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
