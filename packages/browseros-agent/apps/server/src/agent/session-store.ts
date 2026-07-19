import type { BrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import type { BrowserContext } from '@browseros/shared/schemas/browser-context'
import type { GateContext } from '@browseros/shared/trust/consequence-class'
import type { UIMessage } from 'ai'
import { asc, eq } from 'drizzle-orm'
import { getDb } from '../lib/db'
import { chatMessages, chatSessions } from '../lib/db/schema/chat-sessions'
import { logger } from '../lib/logger'
import type { AiSdkAgent } from './ai-sdk-agent'

export interface AgentSession {
  agent: AiSdkAgent
  hiddenPageId?: number
  /** Browser context scoped to the scheduled hidden page. */
  browserContext?: BrowserContext
  /** MCP server names used when the session was created, for change detection. */
  mcpServerKey?: string
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

  get(conversationId: string): AgentSession | undefined {
    return this.sessions.get(conversationId)
  }

  set(conversationId: string, session: AgentSession): void {
    this.deletedSessions.delete(conversationId)
    this.sessions.set(conversationId, session)
    logger.info('Session added to store', {
      conversationId,
      totalSessions: this.sessions.size,
    })
  }

  has(conversationId: string): boolean {
    return this.sessions.has(conversationId)
  }

  remove(conversationId: string): boolean {
    const existed = this.sessions.delete(conversationId)
    if (existed) {
      logger.info('Session removed from store (without dispose)', {
        conversationId,
        remainingSessions: this.sessions.size,
      })
    }
    return existed
  }

  async delete(conversationId: string): Promise<boolean> {
    const session = this.sessions.get(conversationId)
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
      this.sessions.delete(conversationId)
    }

    const deleted = Boolean(existing || session)
    if (deleted) {
      this.deletedSessions.add(conversationId)
      this.persistLocks.delete(conversationId)
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
    if (this.deletedSessions.has(conversationId)) return false
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
    const prev = this.persistLocks.get(sessionId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    this.persistLocks.set(
      sessionId,
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
    if (this.deletedSessions.has(sessionId)) {
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

    const rows = messages.map((m, i) => ({
      id: `${sessionId}-msg-${i}-${now}`,
      sessionId,
      role: m.role,
      content: JSON.stringify(
        m.parts ?? (m as { content?: string }).content ?? '',
      ),
      createdAt: now + i,
    }))
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

    return rows.map((r) => {
      let content = r.content
      try {
        content = JSON.parse(r.content)
      } catch {}

      return {
        id: r.id,
        role: r.role as UIMessage['role'],
        parts: Array.isArray(content) ? content : undefined,
        content: typeof content === 'string' ? content : '',
      } as UIMessage
    })
  }
}
