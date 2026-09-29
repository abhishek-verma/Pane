import { beforeEach, expect, it, mock } from 'bun:test'

const values = new Map<string, Record<string, unknown>>()
let response: Record<string, unknown>
let request: { token: string; pin: boolean }
let status = 200
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
mock.module('@/lib/browseros/agent-fetch', () => ({
  agentFetch: async (_url: string, init: RequestInit) => {
    request = JSON.parse(String(init.body))
    return Response.json(response, { status })
  },
}))
mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://localhost',
}))
mock.module('@/lib/personal-internet/open-pi-href', () => ({
  openPiHref: async () => {},
}))
mock.module('@/lib/personal-internet/pi-document', () => ({
  isPiRoutePath: () => false,
  navigateOwnedRoute: () => {},
}))
const { executeWidgetAction } = await import('./widget-actions')
const approve = {
  type: 'resolve-approval',
  approvalId: 'approval',
  token: 'approve-token',
  resolution: 'approve',
} as const
beforeEach(() => {
  values.clear()
  status = 200
  response = {
    resolution: 'approved',
    resumed: true,
    approval: { conversationId: 'chat', consequenceClass: 'system' },
  }
})
it('remembers Always allow and asks the server to update the live chat before resuming', async () => {
  const result = await executeWidgetAction({ ...approve, trustScope: 'always' })
  expect(request).toEqual({ token: 'approve-token', pin: true })
  expect(result?.ok).toBe(true)
  expect(values.get('local:trust-pins')).toEqual({ system: { pinned: true } })
  expect(values.has('local:conversation-trust-pins')).toBe(false)
})
it('keeps chat-only approval out of global permissions', async () => {
  await executeWidgetAction({ ...approve, trustScope: 'chat' })
  expect(request.pin).toBe(true)
  expect(values.has('local:trust-pins')).toBe(false)
  expect(values.get('local:conversation-trust-pins')).toEqual({
    chat: { system: true },
  })
})
it('does not remember ordinary Approve or Deny', async () => {
  await executeWidgetAction(approve)
  expect(request.pin).toBe(false)
  response.resolution = 'denied'
  await executeWidgetAction({
    ...approve,
    token: 'deny-token',
    resolution: 'deny',
    trustScope: 'always',
  })
  expect(request.pin).toBe(false)
  expect(values.size).toBe(0)
})
it('never grants trust for expired, replayed, denied, or failed approvals', async () => {
  for (const patch of [
    { resolution: 'timeout', resumed: true },
    { resolution: 'approved', resumed: false },
    { resolution: 'denied', resumed: true },
  ]) {
    Object.assign(response, patch)
    const result = await executeWidgetAction({
      ...approve,
      trustScope: 'always',
    })
    expect(values.size).toBe(0)
    if (patch.resolution === 'timeout')
      expect(result?.detail).toContain('expired')
  }
  status = 404
  response = { error: 'unknown token' }
  expect(
    (await executeWidgetAction({ ...approve, trustScope: 'always' }))?.ok,
  ).toBe(false)
  expect(values.size).toBe(0)
})
