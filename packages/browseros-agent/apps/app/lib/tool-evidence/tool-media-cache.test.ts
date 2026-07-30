import { describe, expect, test } from 'bun:test'
import {
  _clearToolOutputCacheForTests,
  _toolOutputCacheSizeForTests,
  getCachedToolOutputText,
  releaseMediaForMessages,
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
})
