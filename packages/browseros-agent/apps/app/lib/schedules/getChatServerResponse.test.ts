import { beforeEach, expect, it, mock } from 'bun:test'
import type { buildChatRequestBody } from '@/lib/messaging/server/buildChatRequestBody'

let workspace: { id: string; path: string; bucketId: string } | null = null
let body: ReturnType<typeof buildChatRequestBody>
let stream = ''
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
