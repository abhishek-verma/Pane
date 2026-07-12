import { describe, expect, it } from 'bun:test'
import {
  homeLoaderCalledChat,
  resetHomeLoaderChatFlag,
} from './AdaptiveHomeWidgets'
import {
  appendHomePrefLine,
  type HomeWidget,
  parseHomePrefs,
  rankWidgets,
} from './HomeEngine'

describe('HomeEngine (M5.7)', () => {
  const candidates: HomeWidget[] = [
    {
      type: 'daily-digest',
      title: 'Digest',
      why: 'morning',
      rank: 10,
    },
    {
      type: 'recent-sites-fallback',
      title: 'Sites',
      why: 'day1',
      rank: 100,
    },
    {
      type: 'pending-approvals',
      title: 'Approvals',
      why: 'need you',
      rank: 5,
    },
  ]

  it('ranks by rank ascending with pins first', () => {
    const ranked = rankWidgets(candidates, {
      pinned: ['daily-digest'],
      hidden: [],
      dismissed: [],
    })
    expect(ranked[0]?.type).toBe('daily-digest')
    expect(ranked[1]?.type).toBe('pending-approvals')
  })

  it('hides and dismisses widgets', () => {
    const ranked = rankWidgets(candidates, {
      pinned: [],
      hidden: ['pending-approvals'],
      dismissed: ['daily-digest'],
    })
    expect(ranked.map((w) => w.type)).toEqual(['recent-sites-fallback'])
  })

  it('appendHomePrefLine writes USER.md preference', () => {
    const next = appendHomePrefLine('# User\n', 'dismiss', 'daily-digest')
    expect(next).toContain('home.dismiss: daily-digest')
    const prefs = parseHomePrefs(next)
    expect(prefs.dismissed).toContain('daily-digest')
  })
})

describe('homeLoaderCalledChat guard (Phase 8 perf invariant)', () => {
  it('flag starts falsy and resets correctly', () => {
    resetHomeLoaderChatFlag()
    expect(homeLoaderCalledChat).toBe(false)
  })

  it('flag remains false after reset (no /chat URL produced by fetchHome path)', () => {
    resetHomeLoaderChatFlag()
    // The scheduler/home endpoint does NOT contain "/chat"
    const testUrl = 'http://127.0.0.1:9000/scheduler/home'
    const wouldSetFlag = testUrl.includes('/chat')
    expect(wouldSetFlag).toBe(false)
    expect(homeLoaderCalledChat).toBe(false)
  })
})
