import { afterEach, describe, expect, mock, test } from 'bun:test'

const agentFetchMock = mock(
  async (_input?: RequestInfo | URL, _init?: RequestInit) =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    }),
)

mock.module('@/lib/browseros/agent-fetch', () => ({
  agentFetch: agentFetchMock,
}))

const {
  _clearToolOutputCacheForTests,
  _toolImageBlobCacheSizeForTests,
  getCachedToolImageBlobUrl,
  releaseMediaForMessages,
} = await import('./tool-media-cache')
const { resolveToolImageBlobUrl, toolImageHttpUrl } = await import(
  './tool-image-url'
)

afterEach(() => {
  _clearToolOutputCacheForTests()
  agentFetchMock.mockClear()
})

describe('toolImageHttpUrl', () => {
  test('builds chat tool-images path without trailing slash issues', () => {
    expect(
      toolImageHttpUrl({
        serverBaseUrl: 'http://127.0.0.1:9100/',
        conversationId: 'c1',
        toolCallId: 't/1',
      }),
    ).toBe('http://127.0.0.1:9100/chat/c1/tool-images/t%2F1')
  })
})

describe('resolveToolImageBlobUrl', () => {
  test('fetches via agentFetch and caches a blob URL', async () => {
    const url = await resolveToolImageBlobUrl({
      serverBaseUrl: 'http://127.0.0.1:9100',
      conversationId: 'conv-1',
      toolCallId: 'call-1',
    })

    expect(url).toMatch(/^blob:/)
    expect(agentFetchMock).toHaveBeenCalledTimes(1)
    const calledWith = agentFetchMock.mock.calls[0]?.[0]
    expect(String(calledWith)).toBe(
      'http://127.0.0.1:9100/chat/conv-1/tool-images/call-1',
    )
    expect(getCachedToolImageBlobUrl('call-1')).toBe(url ?? undefined)
    expect(_toolImageBlobCacheSizeForTests()).toBe(1)
  })

  test('cache hit skips a second network fetch', async () => {
    const first = await resolveToolImageBlobUrl({
      serverBaseUrl: 'http://127.0.0.1:9100',
      conversationId: 'conv-1',
      toolCallId: 'call-2',
    })
    const second = await resolveToolImageBlobUrl({
      serverBaseUrl: 'http://127.0.0.1:9100',
      conversationId: 'conv-1',
      toolCallId: 'call-2',
    })
    expect(second).toBe(first)
    expect(agentFetchMock).toHaveBeenCalledTimes(1)
  })

  test('releaseMediaForMessages revokes cached blob URLs', async () => {
    await resolveToolImageBlobUrl({
      serverBaseUrl: 'http://127.0.0.1:9100',
      conversationId: 'conv-1',
      toolCallId: 'call-3',
    })
    expect(_toolImageBlobCacheSizeForTests()).toBe(1)

    releaseMediaForMessages([
      { parts: [{ type: 'tool-act', toolCallId: 'call-3' }] },
    ])

    expect(getCachedToolImageBlobUrl('call-3')).toBeUndefined()
    expect(_toolImageBlobCacheSizeForTests()).toBe(0)
  })

  test('throws when the server rejects the image request', async () => {
    agentFetchMock.mockImplementationOnce(
      async () => new Response('nope', { status: 400 }),
    )
    await expect(
      resolveToolImageBlobUrl({
        serverBaseUrl: 'http://127.0.0.1:9100',
        conversationId: 'conv-1',
        toolCallId: 'missing',
      }),
    ).rejects.toThrow(/Failed to load tool image \(400\)/)
  })
})
