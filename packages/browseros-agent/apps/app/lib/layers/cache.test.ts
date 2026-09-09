import { describe, expect, it } from 'bun:test'
import { LayerRuntimeCache } from './cache'

const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const origin = 'https://example.com'
const manifest = {
  protocol: 'pane.layers.v1',
  profileId,
  revision: 1,
  paused: false,
  pausedOrigins: [],
  layers: [
    {
      id: 'quiet',
      version: 'a'.repeat(64),
      definition: {
        protocol: 'pane.layers.v1',
        name: 'Quiet',
        intent: 'Hide recommendations',
        mode: 'managed',
        scope: { origin, paths: ['/*'] },
        operations: [
          {
            id: 'hide',
            kind: 'collapse',
            label: 'Recommendations',
            anchor: { selector: 'aside' },
          },
        ],
      },
    },
  ],
}

describe('Layer offline cache', () => {
  it('keeps disable overrides through reconnects and worker/browser restarts', () => {
    const first = new LayerRuntimeCache(profileId)
    expect(first.accept(manifest)).toBe('accepted')
    first.disable('quiet')
    const restarted = new LayerRuntimeCache(profileId, first.serialize())
    expect(restarted.accept({ ...manifest, revision: 2 })).toBe('accepted')
    expect(restarted.effective(origin)).toEqual([])
    expect(restarted.acknowledgeEnable('quiet', 1)).toBe(false)
    expect(restarted.acknowledgeEnable('quiet', 2)).toBe(true)
    expect(restarted.effective(origin)).toHaveLength(1)
  })
  it('rejects stale, foreign-profile and conflicting same-revision manifests', () => {
    const cache = new LayerRuntimeCache(profileId)
    cache.accept(manifest)
    expect(cache.accept(manifest)).toBe('duplicate')
    expect(cache.accept({ ...manifest, revision: 0 })).toBe('stale')
    expect(cache.accept({ ...manifest, paused: true })).toBe('invalid')
    expect(
      cache.accept({
        ...manifest,
        profileId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).toBe('invalid')
    expect(cache.effective(origin)).toHaveLength(1)
  })
  it('does not import another profile cache or mutate its internal definitions', () => {
    const cache = new LayerRuntimeCache(profileId)
    cache.accept(manifest)
    const result = cache.effective(origin)
    result[0].definition.name = 'Changed'
    expect(cache.effective(origin)[0].definition.name).toBe('Quiet')
    expect(
      new LayerRuntimeCache(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        cache.serialize(),
      ).effective(origin),
    ).toEqual([])
  })
  it('applies site and global pauses locally while offline', () => {
    const cache = new LayerRuntimeCache(profileId)
    cache.accept(manifest)
    cache.pause(true, origin)
    expect(
      new LayerRuntimeCache(profileId, cache.serialize()).effective(origin),
    ).toEqual([])
    cache.pause(false, origin)
    expect(cache.effective(origin)).toHaveLength(1)
    cache.pause(true)
    expect(cache.effective(origin)).toEqual([])
    cache.pause(false)
    cache.accept({ ...manifest, revision: 2, paused: true })
    expect(cache.effective(origin)).toEqual([])
  })
})
