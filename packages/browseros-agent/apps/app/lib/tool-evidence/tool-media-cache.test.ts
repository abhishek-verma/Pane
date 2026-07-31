import { describe, expect, test } from 'bun:test'
import {
  _clearToolOutputCacheForTests,
  _toolImageBlobCacheSizeForTests,
  _toolOutputCacheSizeForTests,
  getCachedToolImageBlobUrl,
  getCachedToolOutputText,
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
    setCachedToolImageBlobUrl('img-1', blobUrl)
    setCachedToolImageBlobUrl(
      'img-2',
      URL.createObjectURL(new Blob([new Uint8Array([8])])),
    )
    expect(_toolImageBlobCacheSizeForTests()).toBe(2)

    releaseMediaForMessages([
      { parts: [{ type: 'tool-act', toolCallId: 'img-1' }] },
    ])

    expect(getCachedToolImageBlobUrl('img-1')).toBeUndefined()
    expect(getCachedToolImageBlobUrl('img-2')).toBeTruthy()
    expect(_toolImageBlobCacheSizeForTests()).toBe(1)
  })
})
