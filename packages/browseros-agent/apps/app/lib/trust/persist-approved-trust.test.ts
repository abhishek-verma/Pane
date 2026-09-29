import { afterAll, beforeEach, expect, it, mock } from 'bun:test'

const values = new Map<string, Record<string, unknown>>()
mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: (key: string) => ({
      getValue: async () => values.get(key) ?? {},
      setValue: async (value: Record<string, unknown>) => {
        values.set(key, value)
      },
    }),
  },
}))
const { persistApprovedTrust } = await import('./persist-approved-trust')
beforeEach(() => values.clear())
afterAll(() => mock.restore())
const approved = { ok: true, resumed: true, resolution: 'approved' }

it('persists Always allow only in the global trust store so revocation does not leave a chat grant', async () => {
  await persistApprovedTrust({
    result: approved,
    scope: 'always',
    conversationId: 'chat',
    consequenceClass: 'system',
  })
  expect(values.get('local:trust-pins')).toEqual({ system: { pinned: true } })
  expect(values.has('local:conversation-trust-pins')).toBe(false)
})
it('chat-only approval never grants global trust', async () => {
  await persistApprovedTrust({
    result: approved,
    scope: 'chat',
    conversationId: 'chat',
    consequenceClass: 'system',
  })
  expect(values.has('local:trust-pins')).toBe(false)
})
it('rejects stale, denied, failed, and unknown-class approvals without persisting anything', async () => {
  for (const result of [
    { ...approved, resumed: false },
    { ...approved, resolution: 'denied' },
    { ...approved, ok: false },
  ]) {
    expect(
      await persistApprovedTrust({
        result,
        scope: 'always',
        conversationId: 'chat',
        consequenceClass: 'system',
      }),
    ).toBe(false)
  }
  expect(
    await persistApprovedTrust({
      result: approved,
      scope: 'always',
      conversationId: 'chat',
      consequenceClass: 'unknown',
    }),
  ).toBe(false)
  expect(values.size).toBe(0)
})

it('can remember global trust for a request without a conversation', async () => {
  expect(
    await persistApprovedTrust({
      result: approved,
      scope: 'always',
      consequenceClass: 'system',
    }),
  ).toBe(true)
  expect(values.get('local:trust-pins')).toEqual({ system: { pinned: true } })
  expect(values.has('local:conversation-trust-pins')).toBe(false)
})
