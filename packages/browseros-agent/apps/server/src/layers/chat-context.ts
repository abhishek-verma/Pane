import type { ChatRequest } from '../api/types'
import { getDbHandle } from '../lib/db'

// Keep only execution preferences. Credentials, approval responses and user
// messages stay in their existing provider/transcript stores.
function layerChatPreferences(request: ChatRequest) {
  return {
    browserContext: request.browserContext,
    userSystemPrompt: request.userSystemPrompt,
    userWorkingDir: request.userWorkingDir,
    workspaceId: request.workspaceId,
    bucketId: request.bucketId,
    trustPins: request.trustPins,
    requireBrowserInputApproval: request.requireBrowserInputApproval,
    supportsImages: request.supportsImages,
    declinedApps: request.declinedApps,
    origin: request.origin,
    contextWindowSize: request.contextWindowSize,
  }
}

function database() {
  const db = getDbHandle().sqlite
  db.exec(`CREATE TABLE IF NOT EXISTS layer_chat_context (
    conversation_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL,
    preferences_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS layer_authoring_chat (
    layer_id TEXT NOT NULL, version TEXT NOT NULL, conversation_id TEXT NOT NULL,
    PRIMARY KEY (layer_id, version)
  )`)
  return db
}

export function rememberLayerChatContext(request: ChatRequest) {
  if (!request.providerId) return
  database()
    .query(`INSERT OR REPLACE INTO layer_chat_context VALUES (?, ?, ?, ?)`)
    .run(
      request.conversationId,
      request.providerId,
      JSON.stringify(layerChatPreferences(request)),
      Date.now(),
    )
}

export function bindLayerAuthoringChat(
  layerId: string,
  version: string,
  conversationId: string,
) {
  database()
    .query('INSERT OR REPLACE INTO layer_authoring_chat VALUES (?, ?, ?)')
    .run(layerId, version, conversationId)
}

export function readLayerChatContext(
  layerId: string,
  version: string,
  providerId: string,
) {
  const db = database()
  const parent = db
    .query<{ conversation_id: string }, [string, string]>(
      'SELECT conversation_id FROM layer_authoring_chat WHERE layer_id=? AND version=?',
    )
    .get(layerId, version)
  const row = parent
    ? db
        .query<{ preferences_json: string }, [string]>(
          'SELECT preferences_json FROM layer_chat_context WHERE conversation_id=?',
        )
        .get(parent.conversation_id)
    : db
        .query<{ preferences_json: string }, [string]>(
          'SELECT preferences_json FROM layer_chat_context WHERE provider_id=? ORDER BY updated_at DESC LIMIT 1',
        )
        .get(providerId)
  // Existing Layers predate authoring links. Use the provider's latest chat
  // preferences, but never copy an unrelated conversation's transcript.
  return {
    conversationId: parent?.conversation_id,
    preferences: (row
      ? (JSON.parse(row.preferences_json) as ReturnType<
          typeof layerChatPreferences
        >)
      : {}) as Partial<ReturnType<typeof layerChatPreferences>>,
  }
}
