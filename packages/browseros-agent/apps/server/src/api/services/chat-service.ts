/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Browser } from '@browseros/browser-core/browser'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { createBrowserOutputFileAccess } from '@browseros/browser-mcp/output-file'
import type {
  ConsequenceClass,
  GateContext,
  TrustPin,
} from '@browseros/shared/trust/consequence-class'
import { createAgentUIStreamResponse, type UIMessage } from 'ai'
import { isAcpProvider } from '../../agent/acp-providers'
import { AiSdkAgent } from '../../agent/ai-sdk-agent'
import { formatUserMessage } from '../../agent/format-message'
import {
  filterValidMessages,
  sanitizeMessagesForToolset,
} from '../../agent/message-validation'
import { runTracker } from '../../agent/run-tracker'
import type { AgentSession, SessionStore } from '../../agent/session-store'
import type { ResolvedAgentConfig } from '../../agent/types'
import { buildAcpMcpServers } from '../../lib/agents/acpx-provider/buildAcpMcpServers'
import { resolveLLMConfig } from '../../lib/clients/llm/config'
import { logger } from '../../lib/logger'
import { finalizeSkillOutcomesForRun } from '../../memory/skill-outcomes'
import { indexWorkspaceFiles } from '../../retrieval/workspace-index'
import { defaultWorkspace } from '../../tools/filesystem/workspace'
import type { BrowserContext, ChatRequest } from '../types'
import { resolveBrowserContextPageIds } from '../utils/resolve-browser-context-page-ids'

/** Roots already crawled into graph + embed queue this process lifetime. */
const indexedWorkspaceRoots = new Set<string>()

export interface ChatServiceDeps {
  sessionStore: SessionStore
  browser: Browser
  browserSession: BrowserSession
  browserosId?: string
  aiSdkDevtoolsEnabled?: boolean
  /** Port the BrowserOS server bound to. Forwarded into the ACP MCP
   *  bridge so the spawned agent can dial back into /mcp. */
  serverPort: number
  /** BrowserOS resources directory. Threaded into ACP-backed config
   *  resolutions so the bundled-Bun launcher under
   *  <resourcesDir>/bin/third_party/bun can be located. */
  resourcesDir?: string | null
}

export class ChatService {
  constructor(private deps: ChatServiceDeps) {}

  private createGateContext(request: ChatRequest): GateContext {
    const pins = (request.trustPins ?? {}) as Partial<
      Record<ConsequenceClass, TrustPin>
    >
    return {
      pins,
      browserContext: request.browserContext,
      workspaceRoot: request.userWorkingDir,
      runConsequentialCount: { count: 0 },
      isNewUser: Object.keys(pins).length === 0,
      surface: 'loop',
      conversationId: request.conversationId,
      unattended: Boolean(request.isScheduledTask),
      scheduledRunId: request.scheduledRunId,
      idempotencyKey: request.idempotencyKey,
    }
  }

  private refreshGateContext(
    gateContext: GateContext,
    request: ChatRequest,
  ): void {
    gateContext.pins = (request.trustPins ?? {}) as Partial<
      Record<ConsequenceClass, TrustPin>
    >
    gateContext.browserContext = request.browserContext
    gateContext.workspaceRoot = request.userWorkingDir
    gateContext.isNewUser = Object.keys(gateContext.pins).length === 0
    gateContext.runConsequentialCount.count = 0
    gateContext.conversationId = request.conversationId
    gateContext.unattended = Boolean(request.isScheduledTask)
    gateContext.scheduledRunId = request.scheduledRunId
    gateContext.idempotencyKey = request.idempotencyKey
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: chat request orchestration; refactor tracked separately
  async processMessage(
    request: ChatRequest,
    abortSignal: AbortSignal,
  ): Promise<Response> {
    const { sessionStore } = this.deps

    const llmConfig = await resolveLLMConfig(request, this.deps.browserosId)

    // Look up the session first so we can stamp isNewConversation onto
    // agentConfig before it flows down into the ACP factory (which uses
    // the flag to decide whether to refresh the workspace instruction
    // file). The original isNewSession flag below stays as-is for the
    // rest of the chat-service logic.
    let session = sessionStore.get(request.conversationId)
    const isFirstTurn = !session

    const gateContext = session?.gateContext ?? this.createGateContext(request)
    this.refreshGateContext(gateContext, request)

    if (
      request.userWorkingDir &&
      !indexedWorkspaceRoots.has(request.userWorkingDir)
    ) {
      indexedWorkspaceRoots.add(request.userWorkingDir)
      void indexWorkspaceFiles({
        root: request.userWorkingDir,
        bucketId: request.bucketId ?? 'default',
      })
        .then((n) => {
          if (n > 0) {
            logger.info('Indexed workspace files for retrieval', {
              root: request.userWorkingDir,
              files: n,
            })
          }
        })
        .catch((err: unknown) => {
          logger.warn('Workspace index failed', { err: String(err) })
        })
    }

    const agentConfig: ResolvedAgentConfig = {
      conversationId: request.conversationId,
      provider: llmConfig.provider,
      providerId: llmConfig.providerId,
      model: llmConfig.model,
      apiKey: llmConfig.apiKey,
      baseUrl: llmConfig.baseUrl,
      upstreamProvider: llmConfig.upstreamProvider,
      resourceName: llmConfig.resourceName,
      region: llmConfig.region,
      accessKeyId: llmConfig.accessKeyId,
      secretAccessKey: llmConfig.secretAccessKey,
      sessionToken: llmConfig.sessionToken,
      accountId: llmConfig.accountId,
      reasoningEffort: request.reasoningEffort,
      reasoningSummary: request.reasoningSummary,
      contextWindowSize: request.contextWindowSize,
      userSystemPrompt: request.userSystemPrompt,
      workspace: request.userWorkingDir
        ? defaultWorkspace(request.userWorkingDir, {
            bucketId: request.bucketId ?? 'default',
            workspaceId: request.workspaceId,
          })
        : undefined,
      workingDir: request.userWorkingDir,
      supportsImages: request.supportsImages,
      chatMode: request.mode === 'chat',
      isScheduledTask: request.isScheduledTask,
      origin: request.origin,
      declinedApps: request.declinedApps,
      browserosId: this.deps.browserosId,
      acpAgentId: request.acpAgentId,
      acpCommand: request.acpCommand,
      acpFixedWorkspacePath: request.acpFixedWorkspacePath,
      acpMcpServers: isAcpProvider(llmConfig.provider)
        ? buildAcpMcpServers({
            serverPort: this.deps.serverPort,
            conversationId: request.conversationId,
            providerId: llmConfig.provider,
            defaultWindowId: request.browserContext?.windowId,
            enabledMcpServers: request.browserContext?.enabledMcpServers,
            customMcpServers: request.browserContext?.customMcpServers,
          })
        : undefined,
      isNewConversation: isFirstTurn,
      resourcesDir: this.deps.resourcesDir,
      gateContext,
    }

    let isNewSession = false
    const contextChanges: string[] = []

    // Build stable keys for change detection
    const mcpServerKey = this.buildMcpServerKey(request.browserContext)

    // Detect MCP config change mid-conversation → rebuild session
    if (session && session.mcpServerKey !== mcpServerKey) {
      logger.info('MCP servers changed mid-conversation, rebuilding session', {
        conversationId: request.conversationId,
        previous: session.mcpServerKey,
        current: mcpServerKey,
      })

      const previousMcpKey = session.mcpServerKey ?? ''
      session = await this.rebuildSession(
        session,
        request,
        agentConfig,
        mcpServerKey,
      )

      const oldParts = previousMcpKey.split(',').filter(Boolean)
      const newParts = mcpServerKey.split(',').filter(Boolean)
      const oldServers = new Set(oldParts)
      const newServers = new Set(newParts)
      const added = [...newServers].filter((s) => !oldServers.has(s))
      const removed = [...oldServers].filter((s) => !newServers.has(s))

      const parts: string[] = []
      if (removed.length > 0) {
        parts.push(
          `The following app integrations were disconnected: ${removed.join(', ')}. Their tools are no longer available.`,
        )
      }
      if (added.length > 0) {
        parts.push(
          `The following app integrations were connected: ${added.join(', ')}. Their tools are now available.`,
        )
      }
      if (parts.length === 0) {
        parts.push(
          'Connected app integrations changed during this conversation. Use only tools that are currently registered.',
        )
      }
      contextChanges.push(parts.join(' '))
    }

    // Detect workspace change mid-conversation → rebuild session
    if (session && session.workingDir !== request.userWorkingDir) {
      logger.info('Workspace changed mid-conversation, rebuilding session', {
        conversationId: request.conversationId,
        previous: session.workingDir ?? '(none)',
        current: request.userWorkingDir ?? '(none)',
      })
      const previousWorkingDir = session.workingDir
      session = await this.rebuildSession(
        session,
        request,
        agentConfig,
        mcpServerKey,
      )

      if (!request.userWorkingDir) {
        contextChanges.push(
          [
            'The user disconnected the workspace during this conversation.',
            'Workspace filesystem tools (filesystem_write, filesystem_edit, filesystem_bash, filesystem_grep, filesystem_find, filesystem_ls, and workspace file reads) are no longer available.',
            'filesystem_read can only read BrowserOS-generated output files returned in this session.',
            'Return other output directly in chat.',
            'If the user asks for file operations, suggest they select a working directory from the chat toolbar.',
          ].join(' '),
        )
      } else if (!previousWorkingDir) {
        if (agentConfig.chatMode) {
          contextChanges.push(
            [
              'The user connected a workspace during this conversation, but read-only chat mode cannot use workspace filesystem tools.',
              'filesystem_read can only read BrowserOS-generated output files returned in this session.',
            ].join(' '),
          )
        } else {
          contextChanges.push(
            `The user connected a workspace during this conversation. Filesystem tools are now available. Working directory: ${request.userWorkingDir}`,
          )
        }
      } else {
        if (agentConfig.chatMode) {
          contextChanges.push(
            [
              'The user switched workspace during this conversation, but read-only chat mode cannot use workspace filesystem tools.',
              'filesystem_read can only read BrowserOS-generated output files returned in this session.',
            ].join(' '),
          )
        } else {
          contextChanges.push(
            `The user switched workspace during this conversation. Filesystem tools now use the new working directory: ${request.userWorkingDir}`,
          )
        }
      }
    }

    if (!session) {
      isNewSession = true
      let hiddenPageId: number | undefined
      let browserContext = await resolveBrowserContextPageIds(
        this.deps.browser,
        request.browserContext,
      )
      if (request.isScheduledTask) {
        try {
          hiddenPageId = await this.deps.browser.newPage('about:blank', {
            hidden: true,
            background: true,
          })
          let hiddenWindowId: number | undefined
          try {
            const hiddenPage = (await this.deps.browser.listPages()).find(
              (page) => page.pageId === hiddenPageId,
            )
            hiddenWindowId = hiddenPage?.windowId
          } catch (error) {
            logger.warn('Failed to look up hidden page metadata', {
              conversationId: request.conversationId,
              pageId: hiddenPageId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          browserContext = {
            ...browserContext,
            windowId: hiddenWindowId,
            selectedTabs: undefined,
            tabs: undefined,
            activeTab: {
              id: hiddenPageId,
              pageId: hiddenPageId,
              url: 'about:blank',
              title: 'Scheduled Task',
            },
          }
          logger.info('Created hidden page for scheduled task', {
            conversationId: request.conversationId,
            pageId: hiddenPageId,
            windowId: hiddenWindowId,
          })
        } catch (error) {
          logger.warn(
            'Failed to create hidden page, using default browser context',
            {
              error: error instanceof Error ? error.message : String(error),
            },
          )
        }
      }

      const outputFileAccess = createBrowserOutputFileAccess()
      const agent = await AiSdkAgent.create({
        resolvedConfig: agentConfig,
        browserSession: this.deps.browserSession,
        browserContext,
        browserosId: this.deps.browserosId,
        aiSdkDevtoolsEnabled: this.deps.aiSdkDevtoolsEnabled,
        outputFileAccess,
      })
      session = {
        agent,
        hiddenPageId,
        browserContext,
        mcpServerKey,
        workingDir: request.userWorkingDir,
        outputFileAccess,
        gateContext,
      }
      sessionStore.set(request.conversationId, session)

      // Prefer durable SQLite transcript over the client's text-only
      // previousConversation summary (tool parts survive a server restart).
      const persisted = await sessionStore.loadMessages(request.conversationId)
      if (persisted.length > 0) {
        session.agent.messages = filterValidMessages(persisted)
        logger.info('Hydrated session from persisted messages', {
          conversationId: request.conversationId,
          messageCount: session.agent.messages.length,
        })
      }
    }

    if (
      isNewSession &&
      session.agent.messages.length === 0 &&
      request.previousConversation?.length
    ) {
      for (const msg of request.previousConversation) {
        if (!msg.content.trim()) continue
        session.agent.messages.push({
          id: crypto.randomUUID(),
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          parts: [{ type: 'text', text: msg.content }],
        })
      }
      logger.info('Injected previous conversation history', {
        conversationId: request.conversationId,
        messageCount: request.previousConversation.length,
      })
    }

    // Approval resume: the custom transport drops AI SDK approval-response
    // parts, so the client sends `toolApprovalResponses` and we patch the
    // stored transcript before re-running the loop (no new user message).
    if (request.toolApprovalResponses?.length) {
      this.applyToolApprovalResponses(
        session.agent.messages,
        request.toolApprovalResponses,
      )
      logger.info('Applied tool approval responses', {
        conversationId: request.conversationId,
        count: request.toolApprovalResponses.length,
      })

      const runId = crypto.randomUUID()
      gateContext.runId = runId
      runTracker.startRun(runId)

      return createAgentUIStreamResponse({
        agent: session.agent.toolLoopAgent,
        uiMessages: filterValidMessages(session.agent.messages),
        abortSignal,
        onFinish: async ({ messages }: { messages: UIMessage[] }) => {
          try {
            if (!session) return
            session.agent.messages = filterValidMessages(messages)
            this.deps.sessionStore
              .persistMessages(request.conversationId, session.agent.messages)
              .catch((err: unknown) => {
                logger.error('Failed to persist messages', {
                  error: err instanceof Error ? err.message : String(err),
                })
              })
            logger.info('Agent execution complete', {
              conversationId: request.conversationId,
              totalMessages: session.agent.messages.length,
            })
          } finally {
            finalizeSkillOutcomesForRun(runId, !abortSignal.aborted)
            runTracker.endRun(runId)
          }
        },
      })
    }

    const messageContext = request.isScheduledTask
      ? (session.browserContext ?? request.browserContext)
      : request.browserContext
    // Scheduled tasks already have correct internal pageIds from browser.newPage();
    // resolving them again would pass those to resolveTabIds, which expects Chrome
    // tab IDs.
    const resolvedMessageContext = request.isScheduledTask
      ? messageContext
      : await resolveBrowserContextPageIds(this.deps.browser, messageContext)
    const userContent = formatUserMessage(
      request.message,
      resolvedMessageContext,
      request.selectedText,
      request.selectedTextSource,
    )

    // Prepend tool-change context when session was rebuilt mid-conversation
    const contextPrefix =
      contextChanges.length > 0
        ? `${contextChanges.map((c) => `[Context: ${c}]`).join('\n')}\n\n`
        : ''

    // Persist the *raw* user text in session.agent.messages so it
    // round-trips clean to the client's useChat state and to any
    // future history reload. The wrapped form (browser context +
    // <selected_text> + <USER_QUERY>) is built as a transient prompt
    // copy below — the LLM sees it, the user-visible state never
    // does.
    session.agent.appendUserMessage(request.message)
    const promptUserText = contextPrefix + userContent
    const wrappedUserMessageId =
      session.agent.messages[session.agent.messages.length - 1]?.id

    // ACP-backed providers run against a persistent acpx session that
    // owns the agent's conversation memory natively on disk under
    // <stateDir>/<sessionKey>/. Re-feeding the full UIMessage history
    // doubles bookkeeping and, worse, trips the AI SDK validator when
    // it walks phantom tool-<name> parts emitted by acpx-ai-provider
    // under freshly-generated "acpx-N" ids (acpx#37). For ACP turns
    // we send only the new user message — acpx's session/load reads
    // prior turns from disk transparently. The UI continues to see
    // the growing transcript via session.agent.messages.
    //
    // LLM-API providers are stateless and need the full history on
    // each turn, so they keep the existing shape verbatim.
    const isAcp = isAcpProvider(agentConfig.provider)
    const promptUiMessages: UIMessage[] = isAcp
      ? [
          {
            id: wrappedUserMessageId ?? crypto.randomUUID(),
            role: 'user',
            parts: [{ type: 'text', text: promptUserText }],
          },
        ]
      : filterValidMessages(session.agent.messages).map((msg) =>
          msg.id === wrappedUserMessageId && msg.role === 'user'
            ? {
                ...msg,
                parts: [{ type: 'text' as const, text: promptUserText }],
              }
            : msg,
        )

    const runId = crypto.randomUUID()
    gateContext.runId = runId
    runTracker.startRun(runId)

    return createAgentUIStreamResponse({
      agent: session.agent.toolLoopAgent,
      uiMessages: promptUiMessages,
      abortSignal,
      onFinish: async ({ messages }: { messages: UIMessage[] }) => {
        try {
          if (!session) return
          if (isAcp) {
            const existingIds = new Set(session.agent.messages.map((m) => m.id))
            const newMessages = messages.filter((m) => !existingIds.has(m.id))
            const updated = session.agent.messages.map((m) =>
              m.id === wrappedUserMessageId && m.role === 'user'
                ? {
                    ...m,
                    parts: [{ type: 'text' as const, text: request.message }],
                  }
                : m,
            )
            session.agent.messages = filterValidMessages([
              ...updated,
              ...newMessages,
            ])
          } else {
            const restored = messages.map((msg) =>
              msg.id === wrappedUserMessageId && msg.role === 'user'
                ? {
                    ...msg,
                    parts: [{ type: 'text' as const, text: request.message }],
                  }
                : msg,
            )
            session.agent.messages = filterValidMessages(restored)
          }

          // Persist messages
          this.deps.sessionStore
            .persistMessages(request.conversationId, session.agent.messages)
            .catch((err: unknown) => {
              logger.error('Failed to persist messages', {
                error: err instanceof Error ? err.message : String(err),
              })
            })

          logger.info('Agent execution complete', {
            conversationId: request.conversationId,
            totalMessages: session.agent.messages.length,
          })

          if (session.hiddenPageId) {
            const pageId = session.hiddenPageId
            session.hiddenPageId = undefined
            this.closeHiddenPage(pageId, request.conversationId)
          }
        } finally {
          finalizeSkillOutcomesForRun(runId, !abortSignal.aborted)
          runTracker.endRun(runId)
        }
      },
    })
  }

  async deleteSession(
    conversationId: string,
  ): Promise<{ deleted: boolean; sessionCount: number }> {
    const session = this.deps.sessionStore.get(conversationId)
    if (session?.hiddenPageId) {
      const pageId = session.hiddenPageId
      session.hiddenPageId = undefined
      this.closeHiddenPage(pageId, conversationId)
    }
    const deleted = await this.deps.sessionStore.delete(conversationId)
    return { deleted, sessionCount: this.deps.sessionStore.count() }
  }

  /**
   * Slim history list for the sidepanel. Full transcripts come from
   * `getConversation` so tool parts are not degraded to text.
   */
  async getHistory(): Promise<
    { id: string; lastMessagedAt: number; previewText: string }[]
  > {
    const db = require('../../lib/db').getDb()
    const {
      chatMessages,
      chatSessions,
    } = require('../../lib/db/schema/chat-sessions')
    const { asc, desc, eq } = require('drizzle-orm')

    const sessions = await db
      .select()
      .from(chatSessions)
      .orderBy(desc(chatSessions.updatedAt))
      .all()

    return Promise.all(
      sessions.map(async (s: { id: string; updatedAt: number }) => {
        const msgs = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.sessionId, s.id))
          .orderBy(asc(chatMessages.createdAt))
          .all()

        let previewText = ''
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i] as { role: string; content: string }
          if (m.role !== 'user') continue
          previewText = extractPreviewText(m.content)
          if (previewText) break
        }

        return {
          id: s.id,
          lastMessagedAt: s.updatedAt,
          previewText,
        }
      }),
    )
  }

  async getConversation(
    conversationId: string,
  ): Promise<{ id: string; messages: UIMessage[] } | null> {
    const exists =
      await this.deps.sessionStore.hasPersistedSession(conversationId)
    if (!exists) {
      const live = this.deps.sessionStore.get(conversationId)
      if (!live) return null
      return {
        id: conversationId,
        messages: filterValidMessages(live.agent.messages),
      }
    }
    const messages = await this.deps.sessionStore.loadMessages(conversationId)
    return { id: conversationId, messages: filterValidMessages(messages) }
  }

  async importConversations(
    conversations: Array<{
      id: string
      messages: UIMessage[]
      lastMessagedAt?: number
    }>,
  ): Promise<{ imported: number; skipped: number }> {
    let imported = 0
    let skipped = 0
    for (const conversation of conversations) {
      if (!conversation.id || !Array.isArray(conversation.messages)) {
        skipped++
        continue
      }
      const exists = await this.deps.sessionStore.hasPersistedSession(
        conversation.id,
      )
      if (exists) {
        skipped++
        continue
      }
      await this.deps.sessionStore.persistMessages(
        conversation.id,
        filterValidMessages(conversation.messages),
      )
      imported++
    }
    return { imported, skipped }
  }

  private closeHiddenPage(pageId: number, conversationId: string): void {
    this.deps.browser.closePage(pageId).catch((error) => {
      logger.warn('Failed to close hidden page', {
        pageId,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  private async rebuildSession(
    session: AgentSession,
    request: ChatRequest,
    agentConfig: ResolvedAgentConfig,
    mcpServerKey: string,
  ): Promise<AgentSession> {
    const previousMessages = session.agent.messages
    await session.agent.dispose()
    this.deps.sessionStore.remove(request.conversationId)

    const browserContext = agentConfig.isScheduledTask
      ? (session.browserContext ??
        (await resolveBrowserContextPageIds(
          this.deps.browser,
          request.browserContext,
        )))
      : await resolveBrowserContextPageIds(
          this.deps.browser,
          request.browserContext,
        )
    const outputFileAccess =
      session.outputFileAccess ?? createBrowserOutputFileAccess()
    const agent = await AiSdkAgent.create({
      resolvedConfig: agentConfig,
      browserSession: this.deps.browserSession,
      browserContext,
      browserosId: this.deps.browserosId,
      aiSdkDevtoolsEnabled: this.deps.aiSdkDevtoolsEnabled,
      outputFileAccess,
    })
    const newSession: AgentSession = {
      agent,
      hiddenPageId: session.hiddenPageId,
      browserContext,
      mcpServerKey,
      workingDir: request.userWorkingDir,
      outputFileAccess,
      gateContext: session.gateContext,
    }
    newSession.agent.messages = sanitizeMessagesForToolset(
      previousMessages,
      agent.toolNames,
    )
    this.deps.sessionStore.set(request.conversationId, newSession)
    return newSession
  }

  /**
   * Patches stored assistant tool parts with client approval decisions so the
   * AI SDK can convert them to `tool-approval-response` model messages and
   * re-execute approved tools (or surface denials).
   */
  private applyToolApprovalResponses(
    messages: UIMessage[],
    responses: Array<{
      approvalId: string
      toolCallId: string
      toolName: string
      approved: boolean
      reason?: string
      input?: Record<string, unknown>
    }>,
  ): void {
    const responseMap = new Map(responses.map((r) => [r.approvalId, r]))
    for (const msg of messages) {
      if (msg.role !== 'assistant') continue
      for (const part of msg.parts) {
        const toolPart = part as {
          state?: string
          toolCallId?: string
          input?: Record<string, unknown>
          approval?: { id: string; approved?: boolean; reason?: string }
        }
        if (
          toolPart.state !== 'approval-requested' ||
          !toolPart.approval?.id ||
          !responseMap.has(toolPart.approval.id)
        ) {
          continue
        }
        const resp = responseMap.get(toolPart.approval.id)
        if (!resp) continue
        toolPart.state = 'approval-responded'
        toolPart.approval = {
          ...toolPart.approval,
          approved: resp.approved,
          reason: resp.reason,
        }
        // Prefer the client-edited input when the user changed args before approve.
        if (resp.input) {
          toolPart.input = resp.input
        }
      }
    }
  }

  private buildMcpServerKey(browserContext?: BrowserContext): string {
    const managed = browserContext?.enabledMcpServers?.slice().sort() ?? []
    const custom =
      browserContext?.customMcpServers?.map((s) => s.url).sort() ?? []
    return [...managed, ...custom].filter(Boolean).join(',')
  }
}

function extractPreviewText(rawContent: string): string {
  try {
    const content = JSON.parse(rawContent)
    if (typeof content === 'string') return content.trim()
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part && typeof part === 'object' && 'text' in part) {
            return String((part as { text?: string }).text ?? '')
          }
          return ''
        })
        .join('')
        .trim()
    }
  } catch {
    return rawContent.trim()
  }
  return ''
}
