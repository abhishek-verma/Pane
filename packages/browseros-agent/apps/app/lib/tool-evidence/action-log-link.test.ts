import { describe, expect, test } from 'bun:test'
import { actionLogHref } from './action-log-link'

describe('actionLogHref', () => {
  test('builds hash route without conversation', () => {
    expect(actionLogHref()).toBe('#/settings/action-log')
  })

  test('appends conversationId query', () => {
    expect(actionLogHref('abc-123')).toBe(
      '#/settings/action-log?conversationId=abc-123',
    )
  })
})
