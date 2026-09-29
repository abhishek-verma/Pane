import { beforeEach, expect, it, mock } from 'bun:test'
import type { buildChatRequestBody } from '@/lib/messaging/server/buildChatRequestBody'

let workspace: { id: string; path: string; bucketId: string } | null = null
let body: ReturnType<typeof buildChatRequestBody>
let stream = ''
let trustPins: Record<string, { pinned: boolean; expiresAt?: number }> = {}
let conversationPins: Record<string, Record<string, boolean>> = {}
const workspaceRead = mock(async () => workspace)
mock.module('@/lib/browseros/agent-fetch', () => ({
  agentFetch: async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body))
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream' },
    })
  },
}))
mock.module('@/lib/browseros/helpers', () => ({
  getAgentServerUrl: async () => 'http://localhost',
}))
mock.module('@/lib/llm-providers/storage', () => ({
  resolveStoredChatProvider: async () => ({
    id: 'provider',
    type: 'openai',
    name: 'Test',
    modelId: 'test',
  }),
}))
mock.module('@/lib/mcp/mcpServerStorage', () => ({
  mcpServerStorage: {
    getValue: async () => [
      { type: 'managed', managedServerName: 'calendar' },
      {
        type: 'custom',
        displayName: 'Work',
        config: { url: 'https://example.test/mcp' },
      },
    ],
  },
}))
mock.module('@/lib/trust/trust-pins-storage', () => ({
  requireBrowserInputApprovalStorage: { getValue: async () => true },
  trustPinsStorage: {
    getValue: async () => trustPins,
    setValue: async (value: typeof trustPins) => {
      trustPins = value
    },
  },
  conversationTrustStorage: {
    getValue: async () => conversationPins,
    setValue: async (value: typeof conversationPins) => {
      conversationPins = value
    },
  },
  PINNABLE_CLASSES: ['write-local', 'system', 'write-external', 'spend'],
}))
mock.module('@/lib/workspace/workspace-storage', () => ({
  selectedWorkspaceStorage: { getValue: workspaceRead },
}))
mock.module('@/lib/personalization/personalizationStorage', () => ({
  personalizationStorage: { getValue: async () => '' },
}))
const { getChatServerResponse } = await import('./getChatServerResponse')
beforeEach(() => {
  workspace = { id: 'work', path: '/selected/work', bucketId: 'work-bucket' }
  workspaceRead.mockClear()
  trustPins = {}
  conversationPins = {}
  stream =
    'data: {"type":"text-delta","delta":"Reviewed"}\n\ndata: {"type":"finish","finishReason":"stop"}\n\n'
})
it('sends the review owner, connected apps and selected workspace to the actual chat request builder', async () => {
  const response = await getChatServerResponse({
    message: 'Review today',
    scheduledRunId: 'run-review',
    conversationId: 'review-owner',
    idempotencyKey: 'review-key',
    useSelectedWorkspace: true,
  })
  expect(body.userWorkingDir).toBe('/selected/work')
  expect(body.workspaceId).toBe('work')
  expect(body.bucketId).toBe('work-bucket')
  expect(body.scheduledRunId).toBe('run-review')
  expect(body.conversationId).toBe('review-owner')
  expect(body.idempotencyKey).toBe('review-key')
  expect(body.isScheduledTask).toBe(true)
  expect(body.browserContext?.enabledMcpServers).toEqual(['calendar'])
  expect(body.browserContext?.customMcpServers).toEqual([
    { name: 'Work', url: 'https://example.test/mcp' },
  ])
  expect(response.text).toBe('Reviewed')
})
it('does not attach a workspace to unrelated scheduled jobs', async () => {
  await getChatServerResponse({ message: 'Run schedule' })
  expect(workspaceRead).not.toHaveBeenCalled()
  expect(body.userWorkingDir).toBeUndefined()
})
it('allows a review without a selected folder and rejects interrupted streams', async () => {
  workspace = null
  await getChatServerResponse({
    message: 'Review today',
    useSelectedWorkspace: true,
  })
  expect(body.userWorkingDir).toBeUndefined()
  stream = 'data: {"type":"text-delta","delta":"Starting"}\n\n'
  await expect(
    getChatServerResponse({ message: 'Review today' }),
  ).rejects.toThrow('without completion')
})
it('uses the saved schedule workspace even after the selected workspace changes', async () => {
  await getChatServerResponse({
    message: 'Read files and PI',
    executionContext: {
      providerId: 'provider',
      userWorkingDir: '/saved/work',
      workspaceId: 'saved',
      bucketId: 'saved-bucket',
    },
    useSelectedWorkspace: true,
  })
  expect(workspaceRead).not.toHaveBeenCalled()
  expect(body.userWorkingDir).toBe('/saved/work')
  expect(body.workspaceId).toBe('saved')
  expect(body.bucketId).toBe('saved-bucket')
})
it('fails explicitly when a saved provider has been removed instead of silently switching providers', async () => {
  await expect(
    getChatServerResponse({
      message: 'Run schedule',
      executionContext: { providerId: 'removed-provider' },
    }),
  ).rejects.toThrow('no longer available')
})
it('does not mark an error finish as a successful run', async () => {
  stream = 'data: {"type":"finish","finishReason":"error"}\n\n'
  await expect(
    getChatServerResponse({ message: 'Run schedule' }),
  ).rejects.toThrow('finished with an error')
})

it('loads remembered permissions afresh for each background run and respects revocation', async () => {
  trustPins = {
    system: { pinned: true },
    spend: { pinned: true, expiresAt: 1 },
  }
  await getChatServerResponse({ message: 'Run schedule' })
  expect(body.trustPins).toEqual(trustPins)
  trustPins = {}
  await getChatServerResponse({ message: 'Run again' })
  expect(body.trustPins).toEqual({})
})
it('limits chat permissions to their owning background conversation', async () => {
  trustPins = { 'write-local': { pinned: true } }
  conversationPins = { owner: { system: true, spend: false } }
  await getChatServerResponse({ message: 'Continue', conversationId: 'owner' })
  expect(body.trustPins).toEqual({
    'write-local': { pinned: true },
    system: { pinned: true },
  })
  await getChatServerResponse({
    message: 'Another run',
    conversationId: 'other',
  })
  expect(body.trustPins).toEqual({ 'write-local': { pinned: true } })
})

it('honors Always allow granted in an ordinary chat when a separate scheduled job starts', async () => {
  const { persistApprovedTrust } = await import(
    '../trust/persist-approved-trust'
  )
  await persistApprovedTrust({
    result: { ok: true, resumed: true, resolution: 'approved' },
    scope: 'always',
    conversationId: 'personal-chat',
    consequenceClass: 'system',
  })
  await getChatServerResponse({
    message: 'Run my scheduled job',
    conversationId: 'separate-background-job',
  })
  expect(body.trustPins).toEqual({ system: { pinned: true } })
})

it('does not retain an implicit chat grant after Always allow is revoked', async () => {
  const { persistApprovedTrust } = await import(
    '../trust/persist-approved-trust'
  )
  await persistApprovedTrust({
    result: { ok: true, resumed: true, resolution: 'approved' },
    scope: 'always',
    conversationId: 'background-job',
    consequenceClass: 'system',
  })
  trustPins = {}
  await getChatServerResponse({
    message: 'Retry the job',
    conversationId: 'background-job',
  })
  expect(body.trustPins).toEqual({})
})
