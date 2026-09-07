import { describe, expect, test } from 'bun:test'
import { homeRefreshMessage } from './home-feedback'

describe('Home refresh feedback', () => {
  test('does not report skipped refreshes as updated', () => {
    expect(
      homeRefreshMessage({ refreshed: [{ outcome: 'skipped-stale' }] }),
    ).toContain('couldn’t update')
  })
  test('distinguishes queued browser work from completed updates', () => {
    expect(
      homeRefreshMessage({ refreshed: [{ outcome: 'harvested' }] }),
    ).toContain('still running')
    expect(homeRefreshMessage({ pending: 2 })).toContain('still running')
  })
  test('explains the limits of a local refresh, including no jobs', () => {
    expect(homeRefreshMessage({})).toContain('already in Pane')
    expect(
      homeRefreshMessage({ refreshed: [{ outcome: 'reprojected' }] }),
    ).toContain('already in Pane')
  })
})
