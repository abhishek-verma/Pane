import { afterAll, expect, it, mock } from 'bun:test'

let pins: Record<string, { pinned: boolean; expiresAt?: number }> = {
  system: { pinned: true, expiresAt: 1234 },
}
let requireInput = false
mock.module('@/lib/trust/trust-pins-storage', () => ({
  trustPinsStorage: { getValue: async () => pins },
  requireBrowserInputApprovalStorage: { getValue: async () => requireInput },
  conversationTrustStorage: {
    getValue: () => {
      throw new Error('A Layer must never copy chat-only grants')
    },
  },
}))
const { readLayerActionTrust } = await import('./action-trust')
afterAll(() => mock.restore())

it('reads current global policy on every click, preserving expiry and global revocation', async () => {
  const first = await readLayerActionTrust()
  expect(first.trustPins).toEqual({ system: { pinned: true, expiresAt: 1234 } })
  pins = {}
  requireInput = true
  const second = await readLayerActionTrust()
  expect(second.trustPins).toEqual({})
  expect(second.requireBrowserInputApproval).toBe(true)
  expect(first.trustPins).toEqual({ system: { pinned: true, expiresAt: 1234 } })
})
