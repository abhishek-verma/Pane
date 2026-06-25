import { describe, expect, it } from 'bun:test'
import { resolveApiBaseUrlFromSources } from './client.helpers'

const fallback = 'http://127.0.0.1:9200'

describe('resolveApiBaseUrlFromSources', () => {
  it('prefers the query override', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'http://127.0.0.1:9200',
        stored: 'http://127.0.0.1:9300',
        launcher: 'http://127.0.0.1:9400',
        fallback,
      }),
    ).toBe('http://127.0.0.1:9200')
  })

  it('uses session storage before the launcher env', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: null,
        stored: 'http://127.0.0.1:9300',
        launcher: 'http://127.0.0.1:9400',
        fallback,
      }),
    ).toBe('http://127.0.0.1:9300')
  })

  it('uses the launcher env before the default fallback', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: null,
        stored: null,
        launcher: 'http://127.0.0.1:9400',
        fallback,
      }),
    ).toBe('http://127.0.0.1:9400')
  })

  it('ignores non-loopback overrides', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'https://example.com',
        stored: 'http://localhost:9300',
        launcher: 'http://0.0.0.0:9400',
        fallback,
      }),
    ).toBe(fallback)
  })

  it('rejects loopback-looking URLs that parse to another host', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'http://127.0.0.1:@example.com',
        stored: null,
        launcher: null,
        fallback,
      }),
    ).toBe(fallback)
  })

  it('rejects malformed ports and pathful URLs', () => {
    expect(
      resolveApiBaseUrlFromSources({
        query: 'http://127.0.0.1:99999',
        stored: 'http://127.0.0.1:9300/cockpit',
        launcher: 'http://127.0.0.1:9400?x=1',
        fallback,
      }),
    ).toBe(fallback)
  })
})
