import type { PreparedChatRequest } from './types'
export const credentialFields = [
  'apiKey',
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
] as const
export function durableChatRequest(
  request: PreparedChatRequest,
): PreparedChatRequest {
  const body = { ...request.body }
  for (const field of credentialFields) delete body[field]
  delete body.previousConversation
  // Attachments already live in the durable ComposerMessage; do not duplicate
  // their base64 payload in every queued request.
  delete body.attachments
  return { path: request.path, body }
}
