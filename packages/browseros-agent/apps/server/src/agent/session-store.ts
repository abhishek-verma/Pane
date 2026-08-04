import type { BrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import type { UIMessage } from 'ai'
import { and, asc, desc, eq, lt, or } from 'drizzle-orm'
import { getDb, getDbHandle } from '../lib/db'
import { chatMessages, chatSessions } from '../lib/db/schema/chat-sessions'
import { logger } from '../lib/logger'
import { tryGetProfileKey } from '../lib/profile-context'
import type { AiSdkAgent } from './ai-sdk-agent'

function liveSessionKey(conversationId: string): string {
  const profile = tryGetProfileKey() ?? ''
  return `${profile}:${conversationId}`
}

/**
 * Stores and retrieves raw screenshot/image blobs by toolCallId.
 * Uses the existing BrowserOS SQLite database with a lazily-created table so no
 * Drizzle migration is required. Images survive server restarts and are deleted
 * when their parent chat session is deleted.
 */
export class ToolImageStore {
  private ensuredProfiles = new Set<string>()

  private ensureTable(): void {
    const profile = tryGetProfileKey() ?? '__explicit__'
    if (this.ensuredProfiles.has(profile)) return
    const sqlite = getDbHandle().sqlite
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tool_images (
        tool_call_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        data BLOB NOT NULL,
        mime_type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS tool_images_session_idx
      ON tool_images (session_id)
    `)
    this.ensuredProfiles.add(profile)
  }

  /**
   * Persist image bytes. Returns false on failure so callers can omit the
   * image instead of leaving a stripped placeholder that cannot be loaded.
   */
  store(
    sessionId: string,
    toolCallId: string,
    data: string,
    mimeType: string,
  ): boolean {
    try {
      this.ensureTable()
      const sqlite = getDbHandle().sqlite
      const buf = Buffer.from(data, 'base64')
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO tool_images (tool_call_id, session_id, data, mime_type, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(toolCallId, sessionId, buf, mimeType, Date.now())
      return true
    } catch (err) {
      logger.warn('ToolImageStore: failed to store image', {
        toolCallId,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  get(toolCallId: string): { data: Buffer; mimeType: string } | null {
    try {
      this.ensureTable()
      const sqlite = getDbHandle().sqlite
      const row = sqlite
        .prepare(
          `SELECT data, mime_type FROM tool_images WHERE tool_call_id = ?`,
        )
        // bun:sqlite returns BLOB columns as a plain Uint8Array, not a
        // Buffer — despite this cast. Uint8Array#toString() ignores its
        // argument and joins bytes as comma-separated decimals (inherited
        // from %TypedArray%.prototype.toString), so `.toString('base64')`
        // on the raw row silently produces garbage instead of base64.
        // Wrap in Buffer.from() here so every caller gets a real Buffer.
        .get(toolCallId) as { data: Uint8Array; mime_type: string } | null
      if (!row) return null
      return { data: Buffer.from(row.data), mimeType: row.mime_type }
    } catch (err) {
      logger.warn('ToolImageStore: failed to get image', {
        toolCallId,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  deleteForSession(sessionId: string): void {
    try {
      this.ensureTable()
      const sqlite = getDbHandle().sqlite
      sqlite
        .prepare(`DELETE FROM tool_images WHERE session_id = ?`)
        .run(sessionId)
    } catch {
      // Non-fatal — images are transient
    }
  }
}

/**
 * Stores full tool output JSON for UI lazy-load. Agent transcript keeps its
 * own copy; this exists so sidepanel projections can spill fat bodies.
 */
export class ToolOutputStore {
  private ensuredProfiles = new Set<string>()

  private ensureTable(): void {
    const profile = tryGetProfileKey() ?? '__explicit__'
    if (this.ensuredProfiles.has(profile)) return
    const sqlite = getDbHandle().sqlite
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tool_outputs (
        tool_call_id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL,
        data TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `)
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS tool_outputs_session_idx
      ON tool_outputs (session_id)
    `)
    this.ensuredProfiles.add(profile)
  }

  store(
    sessionId: string,
    toolCallId: string,
    data: string,
    mimeType = 'application/json',
  ): boolean {
    try {
      this.ensureTable()
      const sqlite = getDbHandle().sqlite
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO tool_outputs (tool_call_id, session_id, data, mime_type, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(toolCallId, sessionId, data, mimeType, Date.now())
      return true
    } catch (err) {
      logger.warn('ToolOutputStore: failed to store output', {
        toolCallId,
        error: err instanceof Error ? err.message : String(err),
      })
      return false
    }
  }

  get(toolCallId: string): { data: string; mimeType: string } | null {
    try {
      this.ensureTable()
      const sqlite = getDbHandle().sqlite
      const row = sqlite
        .prepare(
          `SELECT data, mime_type FROM tool_outputs WHERE tool_call_id = ?`,
        )
        .get(toolCallId) as { data: string; mime_type: string } | null
      if (!row) return null
      return { data: row.data, mimeType: row.mime_type }
    } catch (err) {
      logger.warn('ToolOutputStore: failed to get output', {
        toolCallId,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  deleteForSession(sessionId: string): void {
    try {
      this.ensureTable()
      const sqlite = getDbHandle().sqlite
      sqlite
        .prepare(`DELETE FROM tool_outputs WHERE session_id = ?`)
        .run(sessionId)
    } catch {
      // Non-fatal
    }
  }
}

export interface AgentSession {
  agent: AiSdkAgent
  hiddenPageId?: number
  /** Browser context scoped to the scheduled hidden page. */
  browserContext?: BrowserContext
  /** MCP server names used when the session was created, for change detection. */
  mcpServerKey?: string
  /**
   * Provider/model/baseUrl stamp for mid-chat LLM hot-switch detection.
   * When this changes we rebuild the ToolLoopAgent but keep the transcript.
   */
  llmKey?: string
  /** Workspace directory when the session was created, for change detection. */
  workingDir?: string
  /** Browser-generated output paths returned during this conversation. */
  outputFileAccess?: BrowserOutputFileAccess
  /** Mutable per-run trust gate state; shared with wrapped tools. */
  gateContext?: GateContext
}

export interface PersistMessagesOptions {
  /**
   * When false, skip FTS/embed index sync (mid-turn checkpoints).
   * Default true for final writes.
   */
  syncIndexes?: boolean
}

export class SessionStore {
  private sessions = new Map<string, AgentSession>()
  /** Process-lifetime tombstones so late persist after delete cannot resurrect. */
  private deletedSessions = new Set<string>()
  /** Per-session write serialization (promise chain). */
  private persistLocks = new Map<string, Promise<void>>()
  /** Shared image store for all sessions managed by this store. */
  readonly imageStore = new ToolImageStore()
  /** Full tool-output spill for UI projection (agent transcript stays fat). */
  readonly outputStore = new ToolOutputStore()

  get(conversationId: string): AgentSession | undefined {
    return this.sessions.get(liveSessionKey(conversationId))
  }

  set(conversationId: string, session: AgentSession): void {
    const key = liveSessionKey(conversationId)
    this.deletedSessions.delete(key)
    this.sessions.set(key, session)
    logger.info('Session added to store', {
      conversationId,
      profileKey: tryGetProfileKey(),
      totalSessions: this.sessions.size,
    })
  }

  has(conversationId: string): boolean {
    return this.sessions.has(liveSessionKey(conversationId))
  }

  remove(conversationId: string): boolean {
    const key = liveSessionKey(conversationId)
    const existed = this.sessions.delete(key)
    if (existed) {
      logger.info('Session removed from store (without dispose)', {
        conversationId,
        remainingSessions: this.sessions.size,
      })
    }
    return existed
  }

  async delete(conversationId: string): Promise<boolean> {
    const key = liveSessionKey(conversationId)
    const session = this.sessions.get(key)
    const db = getDb()
    const existing = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.id, conversationId))
      .get()

    if (existing) {
      await db.delete(chatSessions).where(eq(chatSessions.id, conversationId))
    }

    if (session) {
      await session.agent.dispose()
      this.sessions.delete(key)
    }

    const deleted = Boolean(existing || session)
    if (deleted) {
      this.deletedSessions.add(key)
      this.persistLocks.delete(key)
      this.imageStore.deleteForSession(conversationId)
      this.outputStore.deleteForSession(conversationId)
      logger.info('Session deleted', {
        conversationId,
        remainingSessions: this.sessions.size,
        hadLiveSession: Boolean(session),
        hadPersistedSession: Boolean(existing),
      })
    }
    return deleted
  }

  async hasPersistedSession(conversationId: string): Promise<boolean> {
    if (this.deletedSessions.has(liveSessionKey(conversationId))) return false
    const row = await getDb()
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.id, conversationId))
      .get()
    return Boolean(row)
  }

  count(): number {
    return this.sessions.size
  }

  async persistMessages(
    sessionId: string,
    messages: UIMessage[],
    options: PersistMessagesOptions = {},
  ): Promise<void> {
    const syncIndexes = options.syncIndexes !== false
    const lockKey = liveSessionKey(sessionId)
    const prev = this.persistLocks.get(lockKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    this.persistLocks.set(
      lockKey,
      prev.catch(() => {}).then(() => gate),
    )
    await prev.catch(() => {})

    try {
      await this.persistMessagesUnlocked(sessionId, messages, syncIndexes)
    } finally {
      release()
    }
  }

  private async persistMessagesUnlocked(
    sessionId: string,
    messages: UIMessage[],
    syncIndexes: boolean,
  ): Promise<void> {
    if (this.deletedSessions.has(liveSessionKey(sessionId))) {
      logger.info('Skipping persist for deleted session', { sessionId })
      return
    }

    const db = getDb()
    const now = Date.now()

    const existingSession = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .get()

    if (!existingSession) {
      await db.insert(chatSessions).values({
        id: sessionId,
        createdAt: now,
        updatedAt: now,
      })
    } else {
      await db
        .update(chatSessions)
        .set({ updatedAt: now })
        .where(eq(chatSessions.id, sessionId))
    }

    await db.delete(chatMessages).where(eq(chatMessages.sessionId, sessionId))

    if (syncIndexes) {
      try {
        const { clearChatFtsForSession } = await import('../retrieval/chat-fts')
        const { deleteChunksForChatSession } = await import(
          '../retrieval/chunks'
        )
        clearChatFtsForSession(sessionId)
        deleteChunksForChatSession(sessionId)
      } catch {
        /* optional in tests */
      }
    }

    if (messages.length === 0) return

    // Prefer stable UIMessage.id as the row PK so stream → checkpoint →
    // hydrate round-trips keep the same identity (idle hydrate must not
    // treat a rewritten id as a missing assistant and append a twin).
    const usedIds = new Set<string>()
    const rows = messages.map((m, i) => {
      const candidate = typeof m.id === 'string' ? m.id.trim() : ''
      const id =
        candidate.length > 0 && !usedIds.has(candidate)
          ? candidate
          : `${sessionId}-msg-${i}-${now}`
      usedIds.add(id)
      return {
        id,
        sessionId,
        role: m.role,
        content: JSON.stringify({
          id,
          parts: m.parts ?? [],
        }),
        createdAt: now + i,
      }
    })
    await db.insert(chatMessages).values(rows)

    if (!syncIndexes) return

    try {
      const { syncChatFts } = await import('../retrieval/chat-fts')
      const { enqueueEmbed } = await import('../retrieval/queue')
      const { extractChatPlainText } = await import('../retrieval/chat-text')
      for (const row of rows) {
        if (row.role !== 'user' && row.role !== 'assistant') continue
        const plain = extractChatPlainText(row.content)
        if (!plain.trim()) continue
        syncChatFts({
          id: row.id,
          sessionId: row.sessionId,
          role: row.role,
          content: row.content,
        })
        enqueueEmbed({
          bucketId: 'default',
          sourceKind: 'chat',
          sourceId: row.id,
          kind: 'chat',
          title: `${row.role} · ${sessionId.slice(0, 8)}`,
          uri: `chat:${sessionId}`,
          text: plain,
        })
      }
    } catch {
      /* retrieval indexes optional in tests */
    }
  }

  async loadMessages(sessionId: string): Promise<UIMessage[]> {
    const db = getDb()
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt))
      .all()

    return rows.map((r) => rowToUiMessage(r))
  }

  /**
   * Cursor-style page from SQLite without loading the full transcript.
   * Returns chronological messages (oldest→newest within the page).
   */
  async loadMessagesPage(
    sessionId: string,
    options: { beforeId?: string; limit: number },
  ): Promise<{ messages: UIMessage[]; hasMore: boolean }> {
    const db = getDb()
    const limit = Math.max(1, Math.min(options.limit, 100))

    if (options.beforeId) {
      const anchor = await db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.sessionId, sessionId),
            eq(chatMessages.id, options.beforeId),
          ),
        )
        .get()
      if (!anchor) return { messages: [], hasMore: false }

      const rowsDesc = await db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.sessionId, sessionId),
            or(
              lt(chatMessages.createdAt, anchor.createdAt),
              and(
                eq(chatMessages.createdAt, anchor.createdAt),
                lt(chatMessages.id, anchor.id),
              ),
            ),
          ),
        )
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(limit + 1)
        .all()

      const hasMore = rowsDesc.length > limit
      const page = hasMore ? rowsDesc.slice(0, limit) : rowsDesc
      return {
        messages: page.reverse().map((r) => rowToUiMessage(r)),
        hasMore,
      }
    }

    const rowsDesc = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(limit + 1)
      .all()

    const hasMore = rowsDesc.length > limit
    const page = hasMore ? rowsDesc.slice(0, limit) : rowsDesc
    return {
      messages: page.reverse().map((r) => rowToUiMessage(r)),
      hasMore,
    }
  }

  /**
   * Rewrite SQLite content for specific messages after inline-image strip.
   * Does **not** delete other rows (unlike persistMessages).
   */
  async updatePersistedMessageContents(
    sessionId: string,
    messages: UIMessage[],
  ): Promise<void> {
    if (messages.length === 0) return
    const db = getDb()
    for (const m of messages) {
      const id = typeof m.id === 'string' ? m.id.trim() : ''
      if (!id) continue
      await db
        .update(chatMessages)
        .set({
          content: JSON.stringify({
            id,
            parts: m.parts ?? [],
          }),
        })
        .where(
          and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.id, id)),
        )
    }
  }
}

function rowToUiMessage(r: {
  id: string
  role: string
  content: string
}): UIMessage {
  let content: unknown = r.content
  try {
    content = JSON.parse(r.content)
  } catch {
    /* keep raw string */
  }

  if (
    content &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    Array.isArray((content as { parts?: unknown }).parts)
  ) {
    const full = content as {
      id?: string
      role?: string
      parts: UIMessage['parts']
    }
    return {
      id: typeof full.id === 'string' ? full.id : r.id,
      role: (full.role ?? r.role) as UIMessage['role'],
      parts: full.parts,
    } as UIMessage
  }

  return {
    id: r.id,
    role: r.role as UIMessage['role'],
    parts: Array.isArray(content) ? content : [],
    content: typeof content === 'string' ? content : '',
  } as UIMessage
}
