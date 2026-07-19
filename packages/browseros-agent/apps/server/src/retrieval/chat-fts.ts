/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { toOrFtsMatchQuery } from '@browseros/retrieval/fts'
import { getDbHandle } from '../lib/db'
import { extractChatPlainText } from './chat-text'

export function syncChatFts(message: {
  id: string
  sessionId: string
  role: string
  content: string
  bucketId?: string
}): void {
  const text = extractChatPlainText(message.content)
  if (!text.trim()) return
  const db = getDbHandle().sqlite
  db.prepare(`DELETE FROM chat_index WHERE message_id = ?`).run(message.id)
  db.prepare(
    `INSERT INTO chat_index (message_id, session_id, bucket_id, role, content)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    message.id,
    message.sessionId,
    message.bucketId ?? DEFAULT_BUCKET_ID,
    message.role,
    text,
  )
}

export function clearChatFtsForSession(sessionId: string): void {
  getDbHandle()
    .sqlite.prepare(`DELETE FROM chat_index WHERE session_id = ?`)
    .run(sessionId)
}

export function searchChatFts(
  bucketId: string,
  tokens: string[],
  limit: number,
): Array<{
  id: string
  sessionId: string
  role: string
  content: string
}> {
  const match = toOrFtsMatchQuery(tokens)
  if (!match) return []
  return getDbHandle()
    .sqlite.prepare(
      `SELECT message_id AS id, session_id AS sessionId, role, content
       FROM chat_index
       WHERE bucket_id = ?
         AND chat_index MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .all(bucketId, match, limit) as Array<{
    id: string
    sessionId: string
    role: string
    content: string
  }>
}

export function rebuildChatFts(): number {
  const db = getDbHandle().sqlite
  db.prepare(`DELETE FROM chat_index`).run()
  const rows = db
    .prepare(
      `SELECT id, session_id, role, content FROM chat_messages WHERE role IN ('user', 'assistant')`,
    )
    .all() as Array<{
    id: string
    session_id: string
    role: string
    content: string
  }>
  let n = 0
  for (const r of rows) {
    syncChatFts({
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
    })
    n++
  }
  return n
}
