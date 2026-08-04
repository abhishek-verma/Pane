import { describe, expect, test } from 'bun:test'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import {
  clearSessionTabGroup,
  ensureSessionTabGroup,
  getSessionTabGroupId,
} from '../../src/agent/session-tab-groups'

function fakeSession(opts: {
  tabIdForPage: Record<number, number>
  createTabGroupResult?: { group: { groupId: string } }
  createTabGroupError?: Error
}): BrowserSession {
  const cdpCalls: Array<{ method: string; params: unknown }> = []
  return {
    pages: {
      getInfo: (pageId: number) => {
        const tabId = opts.tabIdForPage[pageId]
        return tabId === undefined ? undefined : { pageId, tabId }
      },
    },
    cdp: async (method: string, params?: unknown) => {
      cdpCalls.push({ method, params })
      if (opts.createTabGroupError) throw opts.createTabGroupError
      return opts.createTabGroupResult
    },
  } as unknown as BrowserSession
}

describe('session-tab-groups', () => {
  test('creates a group from the first tab and remembers it', async () => {
    const sessionId = `s1-${crypto.randomUUID()}`
    const session = fakeSession({
      tabIdForPage: { 7: 700 },
      createTabGroupResult: { group: { groupId: 'group-abc' } },
    })

    expect(getSessionTabGroupId(sessionId)).toBeUndefined()
    await ensureSessionTabGroup(session, sessionId, 7)
    expect(getSessionTabGroupId(sessionId)).toBe('group-abc')

    clearSessionTabGroup(sessionId)
  })

  test('is a no-op once a group already exists for the session', async () => {
    const sessionId = `s2-${crypto.randomUUID()}`
    const session = fakeSession({
      tabIdForPage: { 1: 100 },
      createTabGroupResult: { group: { groupId: 'first-group' } },
    })
    await ensureSessionTabGroup(session, sessionId, 1)
    expect(getSessionTabGroupId(sessionId)).toBe('first-group')

    const secondSession = fakeSession({
      tabIdForPage: { 2: 200 },
      createTabGroupResult: { group: { groupId: 'should-not-be-used' } },
    })
    await ensureSessionTabGroup(secondSession, sessionId, 2)
    expect(getSessionTabGroupId(sessionId)).toBe('first-group')

    clearSessionTabGroup(sessionId)
  })

  test('leaves no group tracked when CDP group creation fails', async () => {
    const sessionId = `s3-${crypto.randomUUID()}`
    const session = fakeSession({
      tabIdForPage: { 3: 300 },
      createTabGroupError: new Error('boom'),
    })
    await ensureSessionTabGroup(session, sessionId, 3)
    expect(getSessionTabGroupId(sessionId)).toBeUndefined()
  })

  test('clearSessionTabGroup removes tracked state', async () => {
    const sessionId = `s4-${crypto.randomUUID()}`
    const session = fakeSession({
      tabIdForPage: { 4: 400 },
      createTabGroupResult: { group: { groupId: 'group-xyz' } },
    })
    await ensureSessionTabGroup(session, sessionId, 4)
    expect(getSessionTabGroupId(sessionId)).toBe('group-xyz')
    clearSessionTabGroup(sessionId)
    expect(getSessionTabGroupId(sessionId)).toBeUndefined()
  })
})
