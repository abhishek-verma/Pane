import { afterAll, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChatRequestSchema } from '../../src/api/types'
import {
  bindLayerAuthoringChat,
  readLayerChatContext,
  rememberLayerChatContext,
} from '../../src/layers/chat-context'
import { closeDb, getDbHandle, initializeDb } from '../../src/lib/db'

const root = mkdtempSync(join(tmpdir(), 'layer-context-'))
const dbPath = join(root, 'state.db')
initializeDb({ dbPath })
afterAll(() => {
  closeDb()
  rmSync(root, { recursive: true, force: true })
})

it('persists authoring preferences and the source conversation without persisting credentials or user messages', () => {
  const conversationId = crypto.randomUUID()
  const request = ChatRequestSchema.parse({
    conversationId,
    provider: 'openai',
    providerId: 'saved',
    model: 'deployment-alias',
    apiKey: 'DO_NOT_STORE_THIS_KEY',
    message: 'DO_NOT_STORE_THIS_MESSAGE',
    userWorkingDir: '/project',
    bucketId: 'work',
    trustPins: { 'write-local': { pinned: true } },
    browserContext: {
      customMcpServers: [{ name: 'connector', url: 'https://example.com/mcp' }],
    },
  })
  rememberLayerChatContext(request)
  bindLayerAuthoringChat('layer', 'version', conversationId)
  closeDb()
  initializeDb({ dbPath })
  const context = readLayerChatContext('layer', 'version', 'saved')
  expect(context.conversationId).toBe(conversationId)
  expect(context.preferences.userWorkingDir).toBe('/project')
  expect(context.preferences.browserContext?.customMcpServers?.[0].name).toBe(
    'connector',
  )
  expect(context.preferences).not.toHaveProperty('trustPins')
  expect(context.preferences).not.toHaveProperty('requireBrowserInputApproval')
  const stored = JSON.stringify(
    getDbHandle().sqlite.query('SELECT * FROM layer_chat_context').all(),
  )
  expect(stored).not.toContain('DO_NOT_STORE_THIS_KEY')
  expect(stored).not.toContain('DO_NOT_STORE_THIS_MESSAGE')
  expect(stored).not.toContain('trustPins')
})

it('strips stale global and chat-only trust snapshots from old linked and fallback preferences', () => {
  const id = crypto.randomUUID()
  const oldPreferences = {
    userWorkingDir: '/legacy-project',
    trustPins: { system: { pinned: true }, 'write-external': { pinned: true } },
    requireBrowserInputApproval: false,
  }
  getDbHandle()
    .sqlite.query('INSERT INTO layer_chat_context VALUES (?,?,?,?)')
    .run(id, 'old-provider', JSON.stringify(oldPreferences), Date.now())
  bindLayerAuthoringChat('old-linked', 'version', id)
  for (const layer of ['old-linked', 'old-unlinked']) {
    const context = readLayerChatContext(layer, 'version', 'old-provider')
    expect(context.preferences.userWorkingDir).toBe('/legacy-project')
    expect(context.preferences).not.toHaveProperty('trustPins')
    expect(context.preferences).not.toHaveProperty(
      'requireBrowserInputApproval',
    )
  }
})

it('uses provider preferences for legacy Layers without copying unrelated chat history', () => {
  const context = readLayerChatContext('legacy', 'version', 'saved')
  expect(context.preferences.userWorkingDir).toBe('/project')
  expect(context.conversationId).toBeUndefined()
  expect(
    readLayerChatContext('legacy', 'version', 'different-provider').preferences,
  ).toEqual({})
})
