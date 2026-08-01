import { describe, expect, test } from 'bun:test'
import { UI_TOOL_MEDIA_LIMITS } from '@browseros/shared/constants/limits'
import {
  _clearToolOutputCacheForTests,
  _toolImageBlobCacheSizeForTests,
  _toolOutputCacheSizeForTests,
  getCachedToolImageBlobUrl,
  getCachedToolOutputText,
  getToolMediaCacheStats,
  releaseMediaForMessages,
  setCachedToolImageBlobUrl,
  setCachedToolOutputText,
} from './tool-media-cache'

describe('tool-media-cache', () => {
  test('releaseMediaForMessages drops spilled outputs for dropped turns', () => {
    _clearToolOutputCacheForTests()
    setCachedToolOutputText('t1', 'big-1')
    setCachedToolOutputText('t2', 'big-2')
    expect(_toolOutputCacheSizeForTests()).toBe(2)

    releaseMediaForMessages([
      {
        parts: [{ type: 'tool-browser_snapshot', toolCallId: 't1' }],
      },
    ])

    expect(getCachedToolOutputText('t1')).toBeUndefined()
    expect(getCachedToolOutputText('t2')).toBe('big-2')
    expect(_toolOutputCacheSizeForTests()).toBe(1)
  })

  test('releaseMediaForMessages revokes tool image blob URLs', () => {
    _clearToolOutputCacheForTests()
    const blobUrl = URL.createObjectURL(new Blob([new Uint8Array([9])]))
    setCachedToolImageBlobUrl('img-1', blobUrl, 1)
    setCachedToolImageBlobUrl(
      'img-2',
      URL.createObjectURL(new Blob([new Uint8Array([8])])),
      1,
    )
    expect(_toolImageBlobCacheSizeForTests()).toBe(2)

    releaseMediaForMessages([
      { parts: [{ type: 'tool-act', toolCallId: 'img-1' }] },
    ])

    expect(getCachedToolImageBlobUrl('img-1')).toBeUndefined()
    expect(getCachedToolImageBlobUrl('img-2')).toBeTruthy()
    expect(_toolImageBlobCacheSizeForTests()).toBe(1)
  })

  test('evicts oldest image blobs when over entry cap', () => {
    _clearToolOutputCacheForTests()
    const cap = UI_TOOL_MEDIA_LIMITS.MAX_IMAGE_BLOB_ENTRIES
    for (let i = 0; i < cap + 3; i++) {
      setCachedToolImageBlobUrl(
        `img-${i}`,
        URL.createObjectURL(new Blob([new Uint8Array([i])])),
        1,
      )
    }
    expect(_toolImageBlobCacheSizeForTests()).toBe(cap)
    expect(getCachedToolImageBlobUrl('img-0')).toBeUndefined()
    expect(getCachedToolImageBlobUrl(`img-${cap + 2}`)).toBeTruthy()
    expect(getToolMediaCacheStats().imageEvictionCount).toBeGreaterThan(0)
  })

  test('evicts oldest spilled text when over entry cap', () => {
    _clearToolOutputCacheForTests()
    const cap = UI_TOOL_MEDIA_LIMITS.MAX_OUTPUT_TEXT_ENTRIES
    for (let i = 0; i < cap + 2; i++) {
      setCachedToolOutputText(`t-${i}`, `body-${i}`)
    }
    expect(_toolOutputCacheSizeForTests()).toBe(cap)
    expect(getCachedToolOutputText('t-0')).toBeUndefined()
    expect(getCachedToolOutputText(`t-${cap + 1}`)).toBe(`body-${cap + 1}`)
  })
})
