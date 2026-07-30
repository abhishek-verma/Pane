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
import type { UIMessage } from 'ai'
import { isAcpProvider } from '../../agent/acp-providers'
import { AiSdkAgent } from '../../agent/ai-sdk-agent'
import {
  getDbRunningChatTurn,
  insertRunningChatTurn,
  interruptDbRunningChatTurn,
  markChatTurnTerminal,
} from '../../agent/chat-turns-store'
import {
  type ChatTurnInfo,
  conversationTurnRegistry,
} from '../../agent/conversation-turn-registry'
import {
  chatTurnAttachSseResponse,
  detachableUiStreamResponse,
} from '../../agent/detachable-ui-stream'
import { createDurableAgentUIStreamResponse } from '../../agent/durable-agent-ui-stream'
import { formatUserMessage } from '../../agent/format-message'
import { prepareMessagesForAgentTurn } from '../../agent/message-repair'
import {
  filterValidMessages,
  sanitizeMessagesForToolset,
  stripUIImageOutputs,
} from '../../agent/message-validation'
import { projectMessagesForUi } from '../../agent/project-messages-for-ui'
import { runTracker } from '../../agent/run-tracker'
import type { AgentSession, SessionStore } from '../../agent/session-store'
import { applyToolApprovalDecisions } from '../../agent/tool-approval-resolve'
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

/**
 * Ceiling on how long a single conversation's mutex may be held before a
 * stuck stream (onFinish never fires — cancelled response body that the
 * runtime never reads, unexpected SDK bug, etc.) is force-released. Without
 * this a single wedged turn would permanently block every future message in
 * that conversation, which is worse than the race the mutex prevents.
 * Generous because legitimate agent loops can run for many minutes.
 */
const CONVERSATION_LOCK_WATCHDOG_MS = 15 * 60 * 1000

export class ChatService {
  constructor(private deps: ChatServiceDeps) {}

  /**
   * Per-conversation FIFO queue. Held from request entry until the turn's
   * `onFinish` / cancel completes — not when the HTTP subscriber detaches.
   * Client abort must not release this lock while the agent is still running.
   */
  private readonly conversationLocks = new Map<string, Promise<void>>()
  /** Release callbacks for the in-flight turn, keyed by conversationId. */
  private readonly turnLockReleases = new Map<string, () => void>()

  private async withConversationLock<T>(
    conversationId: string,
    fn: (release: () => void) => Promise<T>,
  ): Promise<T> {
    const prev = this.conversationLocks.get(conversationId) ?? Promise.resolve()
    let releaseGate!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const chained = prev.then(() => gate)
    this.conversationLocks.set(conversationId, chained)

    let released = false
    const release = () => {
      if (released) return
      released = true
      clearTimeout(watchdog)
      releaseGate()
      if (this.conversationLocks.get(conversationId) === chained) {
        this.conversationLocks.delete(conversationId)
      }
    }
    const watchdog = setTimeout(() => {
      logger.warn('Conversation lock watchdog forced release', {
        conversationId,
      })
      release()
    }, CONVERSATION_LOCK_WATCHDOG_MS)

    await prev
    try {
      return await fn(release)
    } catch (err) {
      release()
      throw err
    }
  }

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
    // Counter is informational only now (pins are uncapped). Reset each
    // request so logs stay per-turn.
    gateContext.runConsequentialCount.count = 0
    gateContext.conversationId = request.conversationId
    gateContext.unattended = Boolean(request.isScheduledTask)
    gateContext.scheduledRunId = request.scheduledRunId
    gateContext.idempotencyKey = request.idempotencyKey
  }

  async processMessage(
    request: ChatRequest,
    abortSignal: AbortSignal,
  ): Promise<Response> {
    // Scheduled jobs have no UI reattach consumer; aborting their fetch means
    // cancel the turn. Attended chat: abort = detach only.
    if (request.isScheduledTask) {
      const onAbort = () => {
        this.cancelTurn(request.conversationId, 'scheduled-fetch-aborted')
      }
      if (abortSignal.aborted) onAbort()
      else abortSignal.addEventListener('abort', onAbort, { once: true })
    }

    // Supersede before taking the conversation lock so cancel can unwind the
    // prior turn and release its lock; otherwise a new prompt would queue
    // forever behind a detached still-running turn.
    const isApprovalResume =
      !request.message.trim() &&
      Array.isArray(request.toolApprovalResponses) &&
      request.toolApprovalResponses.length > 0
    if (!isApprovalResume) {
      this.cancelTurn(request.conversationId, 'superseded-by-new-message')
    }

    return this.withConversationLock(request.conversationId, (release) =>
      this.processMessageLocked(request, abortSignal, release),
    )
  }

  /** Active turn for a conversation (memory first; repairs DB split-brain). */
  async getActiveTurn(conversationId: string): Promise<ChatTurnInfo | null> {
    const live = conversationTurnRegistry.getActiveFor(conversationId)
    if (live) {
      return conversationTurnRegistry.describe(live.turnId)
    }
    const dbRunning = await getDbRunningChatTurn(conversationId)
    if (dbRunning) {
      await interruptDbRunningChatTurn(dbRunning.id, 'split-brain')
    }
    return null
  }

  /** Attach a subscriber to a running (or retained) turn. */
  attachTurn(input: {
    conversationId: string
    turnId?: string
    lastSeq?: number
    signal?: AbortSignal
  }): Response | null {
    const turnId =
      input.turnId ??
      conversationTurnRegistry.getActiveFor(input.conversationId)?.turnId
    if (!turnId) return null
    const registered = conversationTurnRegistry.get(turnId)
    if (!registered || registered.conversationId !== input.conversationId) {
      return null
    }
    const live = this.deps.sessionStore.get(input.conversationId)
    const frames = conversationTurnRegistry.subscribe(turnId, {
      fromSeq: input.lastSeq,
      signal: input.signal,
      fallbackMessages: live
        ? this.projectForUiClient(input.conversationId, live.agent.messages)
        : undefined,
    })
    if (!frames) return null
    return chatTurnAttachSseResponse(frames, {
      turnId,
      signal: input.signal,
    })
  }

  /** Explicit cancel (Stop / supersede / delete / scheduled cancel). */
  cancelTurn(conversationId: string, reason?: string): boolean {
    const turn = conversationTurnRegistry.getActiveFor(conversationId)
    if (!turn) return false
    const cancelled = conversationTurnRegistry.cancel(turn.turnId, reason)
    if (cancelled) {
      void markChatTurnTerminal({
        turnId: turn.turnId,
        status: 'cancelled',
        stopReason: reason ?? 'cancelled',
      })
      // Unlock even if onFinish never runs (cancelled body / hung SDK).
      const release = this.turnLockReleases.get(conversationId)
      this.turnLockReleases.delete(conversationId)
      release?.()
    }
    return cancelled
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: chat request orchestration; refactor tracked separately
  private async processMessageLocked(
    request: ChatRequest,
    abortSignal: AbortSignal,
    release: () => void,
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

    // Approval resume: the custom transport drops AI SDK approval-response
    // parts, so the client sends `toolApprovalResponses` and we patch the
    // stored transcript before re-running the loop (no new user message).
    // Empty/whitespace message distinguishes resume from a new user turn
    // that may also carry leftover approval payloads.
    const isApprovalResume =
      !!request.toolApprovalResponses?.length && !request.message?.trim()

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
        imageStore: sessionStore.imageStore,
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
        const hydrated = filterValidMessages(persisted)
        const backfilled = stripUIImageOutputs(
          hydrated,
          request.conversationId,
          sessionStore.imageStore,
        )
        // A server restart or crash can leave tool parts mid-flight
        // (input-available with no result) or carrying legacy AI SDK
        // states (state:'result'/'call') from an older persisted session.
        // Repair before this transcript is ever handed to the loop again,
        // otherwise the very next turn dies with MissingToolResultsError or
        // "Type validation failed".
        //
        // settleApprovals must stay off when this same request is itself an
        // approval resume — otherwise this auto-denies the pending
        // approval-requested part (matches "Session restored...") a few
        // lines before the isApprovalResume block below ever gets a chance
        // to apply the user's actual decision, silently turning every
        // first-turn-after-restart Approve into a no-op Deny.
        const prepared = prepareMessagesForAgentTurn(hydrated, {
          toolNames: session.agent.toolNames,
          settleApprovals: !isApprovalResume,
          settleIncomplete: true,
          approvalReason: 'Session restored before the tool finished',
          incompleteReason: 'Session restored before the tool finished',
        })
        session.agent.messages = prepared.messages
        if (backfilled || prepared.changed) {
          void this.checkpointMessages(
            request.conversationId,
            session.agent.messages,
            false,
          )
        }
        logger.info('Hydrated session from persisted messages', {
          conversationId: request.conversationId,
          messageCount: session.agent.messages.length,
          backfilled,
          repaired: prepared.changed,
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

    if (isApprovalResume) {
      const { patched, unmatched } = applyToolApprovalDecisions(
        session.agent.messages,
        request.toolApprovalResponses ?? [],
      )
      logger.info('Applied tool approval responses', {
        conversationId: request.conversationId,
        count: request.toolApprovalResponses?.length,
        patched,
        unmatchedCount: unmatched.length,
      })
      if (unmatched.length > 0) {
        logger.warn('Unmatched tool approval responses', {
          conversationId: request.conversationId,
          unmatched,
        })
      }

      // settleApprovals stays false: the responses we just applied above are
      // exactly the approval-responded parts settling here would deny.
      // settleIncomplete still runs — a prior aborted resume can leave an
      // unrelated tool call mid-flight alongside the one being resumed.
      const prepared = prepareMessagesForAgentTurn(session.agent.messages, {
        settleApprovals: false,
        settleIncomplete: true,
        incompleteReason: 'Interrupted before a previous resume finished',
      })
      session.agent.messages = prepared.messages
      if (prepared.repairedApprovals > 0) {
        logger.warn('Repaired invalid tool approval parts before resume', {
          conversationId: request.conversationId,
          repaired: prepared.repairedApprovals,
        })
      }

      await this.checkpointMessages(
        request.conversationId,
        session.agent.messages,
        false,
      )

      const runId = crypto.randomUUID()
      gateContext.runId = runId
      runTracker.startRun(runId)

      return this.startDetachedUiTurn({
        request,
        session,
        runId,
        release,
        httpSignal: abortSignal,
        prompt: null,
        uiMessages: filterValidMessages(session.agent.messages),
        applyStreamMessages: (messages) => {
          session.agent.messages = filterValidMessages(messages)
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

    // A new user turn supersedes any still-pending tool approvals and any
    // tool call left mid-flight by a prior abort/crash. Settle both so
    // convertToModelMessages cannot emit orphan tool-calls (SDK
    // MissingToolResultsError / "Something went wrong" dead-end).
    const turnPrepared = prepareMessagesForAgentTurn(session.agent.messages, {
      settleApprovals: true,
      settleIncomplete: true,
    })
    session.agent.messages = turnPrepared.messages
    if (turnPrepared.changed) {
      logger.info(
        'Auto-denied pending tool approvals before new user message',
        {
          conversationId: request.conversationId,
          settled: turnPrepared.settledApprovals,
          repaired: turnPrepared.repairedApprovals,
          settledIncomplete: turnPrepared.settledIncomplete,
        },
      )
      await this.checkpointMessages(
        request.conversationId,
        session.agent.messages,
        false,
      )
    }

    // Persist the *raw* user text in session.agent.messages so it
    // round-trips clean to the client's useChat state and to any
    // future history reload. The wrapped form (browser context +
    // <selected_text> + <USER_QUERY>) is built as a transient prompt
    // copy below — the LLM sees it, the user-visible state never
    // does.
    session.agent.appendUserMessage(request.message)
    await this.checkpointMessages(
      request.conversationId,
      session.agent.messages,
      false,
    )

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

    const applyStreamMessages = (messages: UIMessage[]) => {
      if (isAcp) {
        // Stream originalMessages are only this turn's user prompt. Keep
        // prior turns, restore raw user text, and replace this turn's
        // assistant/tool messages from the stream (including step updates).
        const userIdx = session.agent.messages.findIndex(
          (m) => m.id === wrappedUserMessageId,
        )
        const prior =
          userIdx >= 0
            ? session.agent.messages.slice(0, userIdx)
            : session.agent.messages.filter(
                (m) => !messages.some((sm) => sm.id === m.id),
              )
        const userMsg: UIMessage = {
          id: wrappedUserMessageId ?? crypto.randomUUID(),
          role: 'user',
          parts: [{ type: 'text', text: request.message }],
        }
        const afterUser = messages.filter((m) => m.id !== wrappedUserMessageId)
        session.agent.messages = filterValidMessages([
          ...prior,
          userMsg,
          ...afterUser,
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
    }

    return this.startDetachedUiTurn({
      request,
      session,
      runId,
      release,
      httpSignal: abortSignal,
      prompt: request.message,
      uiMessages: promptUiMessages,
      applyStreamMessages,
      onComplete: () => {
        if (session.hiddenPageId) {
          const pageId = session.hiddenPageId
          session.hiddenPageId = undefined
          this.closeHiddenPage(pageId, request.conversationId)
        }
      },
    })
  }

  /**
   * Register a detached turn, run the AI SDK UI stream on the turn abort
   * signal, tee so HTTP disconnect only detaches, and checkpoint snapshots
   * for late joiners.
   */
  private async startDetachedUiTurn(input: {
    request: ChatRequest
    session: AgentSession
    runId: string
    release: () => void
    httpSignal: AbortSignal
    prompt: string | null
    uiMessages: UIMessage[]
    applyStreamMessages: (messages: UIMessage[]) => void
    onComplete?: () => void
  }): Promise<Response> {
    const { request, session, runId, release, httpSignal } = input

    // Cancel any leftover active turn (e.g. approval resume while one runs).
    conversationTurnRegistry.cancelActiveFor(
      request.conversationId,
      'replaced-by-new-turn',
    )

    const turn = conversationTurnRegistry.register(request.conversationId, {
      prompt: input.prompt,
    })
    await insertRunningChatTurn({
      turnId: turn.turnId,
      sessionId: request.conversationId,
      startedAt: turn.startedAt,
    })
    this.turnLockReleases.set(request.conversationId, release)

    const turnSignal = turn.abortController.signal
    let settled = false
    const settleTurn = async (isAborted: boolean) => {
      if (settled) return
      settled = true
      const status = turnSignal.aborted || isAborted ? 'cancelled' : 'done'
      if (conversationTurnRegistry.get(turn.turnId)?.status === 'running') {
        conversationTurnRegistry.complete(
          turn.turnId,
          status === 'cancelled' ? 'cancelled' : 'done',
        )
      }
      await markChatTurnTerminal({
        turnId: turn.turnId,
        status,
        stopReason: turnSignal.aborted ? 'aborted' : null,
      })
      finalizeSkillOutcomesForRun(runId, !turnSignal.aborted && !isAborted)
      runTracker.endRun(runId)
      this.turnLockReleases.delete(request.conversationId)
      release()
    }

    try {
      const agentResponse = await createDurableAgentUIStreamResponse({
        agent: session.agent.toolLoopAgent,
        uiMessages: input.uiMessages,
        abortSignal: turnSignal,
        conversationId: request.conversationId,
        onStepFinish: async ({ messages }) => {
          input.applyStreamMessages(messages)
          await this.checkpointMessages(
            request.conversationId,
            session.agent.messages,
            false,
          )
          conversationTurnRegistry.pushSnapshot(
            turn.turnId,
            this.projectForUiClient(
              request.conversationId,
              session.agent.messages,
            ),
          )
        },
        onFinish: async ({ messages, isAborted }) => {
          try {
            input.applyStreamMessages(messages)
            await this.checkpointMessages(
              request.conversationId,
              session.agent.messages,
              true,
            )
            conversationTurnRegistry.pushSnapshot(
              turn.turnId,
              this.projectForUiClient(
                request.conversationId,
                session.agent.messages,
              ),
            )
            logger.info('Agent execution complete', {
              conversationId: request.conversationId,
              turnId: turn.turnId,
              totalMessages: session.agent.messages.length,
              isAborted,
            })
            input.onComplete?.()
          } finally {
            await settleTurn(Boolean(isAborted))
          }
        },
      })

      return detachableUiStreamResponse(agentResponse, {
        httpSignal,
        turnId: turn.turnId,
        uiProjection: {
          sessionId: request.conversationId,
          outputStore: this.deps.sessionStore.outputStore,
        },
      })
    } catch (err) {
      await settleTurn(true)
      throw err
    }
  }

  /**
   * UI wire projection: clone + spill fat tool bodies. Never mutates the
   * agent transcript used for model context.
   */
  private projectForUiClient(
    conversationId: string,
    messages: UIMessage[],
  ): UIMessage[] {
    const valid = filterValidMessages(messages)
    // Deep-clone so strip/spill cannot touch agent transcript object graphs.
    const clone = structuredClone(valid) as UIMessage[]
    stripUIImageOutputs(
      clone,
      conversationId,
      this.deps.sessionStore.imageStore,
    )
    return projectMessagesForUi(clone, {
      sessionId: conversationId,
      outputStore: this.deps.sessionStore.outputStore,
    })
  }

  private async checkpointMessages(
    conversationId: string,
    messages: UIMessage[],
    syncIndexes: boolean,
  ): Promise<void> {
    try {
      // Belt-and-suspenders: tool-adapter strips at execute time, but any
      // legacy or missed inline image data is moved to ToolImageStore here
      // before writing SQLite / keeping session.agent.messages bounded.
      stripUIImageOutputs(
        messages,
        conversationId,
        this.deps.sessionStore.imageStore,
      )
      await this.deps.sessionStore.persistMessages(
        conversationId,
        filterValidMessages(messages),
        { syncIndexes },
      )
    } catch (err: unknown) {
      logger.error('Failed to persist messages', {
        conversationId,
        syncIndexes,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async deleteSession(
    conversationId: string,
  ): Promise<{ deleted: boolean; sessionCount: number }> {
    this.cancelTurn(conversationId, 'conversation-deleted')
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
      // Live agent keeps full fidelity; client receives UI projection only.
      return {
        id: conversationId,
        messages: this.projectForUiClient(conversationId, live.agent.messages),
      }
    }
    const messages = await this.deps.sessionStore.loadMessages(conversationId)
    const valid = filterValidMessages(messages)
    // Lazy backfill: migrate fat legacy image rows into tool_images on the
    // persisted agent transcript (model path), then project a UI clone.
    const stripped = stripUIImageOutputs(
      valid,
      conversationId,
      this.deps.sessionStore.imageStore,
    )
    if (stripped) {
      try {
        await this.deps.sessionStore.persistMessages(conversationId, valid, {
          syncIndexes: false,
        })
        logger.info('Backfilled inline tool images for conversation', {
          conversationId,
        })
      } catch (err: unknown) {
        logger.warn('Failed to persist image backfill', {
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return {
      id: conversationId,
      messages: this.projectForUiClient(conversationId, valid),
    }
  }

  /**
   * Cursor-style history page from SQLite (or live session slice).
   * Projects for UI only — does not load the full transcript into memory
   * when the conversation is persisted.
   */
  async listConversationMessages(
    conversationId: string,
    options: { beforeId?: string; limit?: number } = {},
  ): Promise<{
    messages: UIMessage[]
    hasMore: boolean
  } | null> {
    const limit = Math.max(1, Math.min(options.limit ?? 30, 100))
    const exists =
      await this.deps.sessionStore.hasPersistedSession(conversationId)

    if (!exists) {
      const live = this.deps.sessionStore.get(conversationId)
      if (!live) return null
      const all = filterValidMessages(live.agent.messages)
      let end = all.length
      if (options.beforeId) {
        const idx = all.findIndex((m) => m.id === options.beforeId)
        if (idx < 0) return { messages: [], hasMore: false }
        end = idx
      }
      const start = Math.max(0, end - limit)
      return {
        messages: this.projectForUiClient(
          conversationId,
          all.slice(start, end),
        ),
        hasMore: start > 0,
      }
    }

    const page = await this.deps.sessionStore.loadMessagesPage(conversationId, {
      beforeId: options.beforeId,
      limit,
    })
    // Image backfill on the page only (not the whole transcript).
    stripUIImageOutputs(
      page.messages,
      conversationId,
      this.deps.sessionStore.imageStore,
    )
    return {
      messages: this.projectForUiClient(conversationId, page.messages),
      hasMore: page.hasMore,
    }
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
      imageStore: this.deps.sessionStore.imageStore,
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
    // A pending approval or mid-flight tool call can reference a tool that
    // is about to be dropped by the sanitize step below (MCP/workspace
    // change mid-conversation). Settle both before sanitizing, otherwise
    // Approve silently no-ops against a tool part that no longer exists, or
    // the orphaned approval-responded part fails validateUIMessages on the
    // next turn.
    const rebuildPrepared = prepareMessagesForAgentTurn(previousMessages, {
      settleApprovals: true,
      settleIncomplete: true,
      approvalReason: 'Tool no longer available after session rebuild',
      incompleteReason: 'Tool no longer available after session rebuild',
    })
    if (rebuildPrepared.settledApprovals || rebuildPrepared.settledIncomplete) {
      logger.info('Settled pending tool state before session rebuild', {
        conversationId: request.conversationId,
        settledApprovals: rebuildPrepared.settledApprovals,
        settledIncomplete: rebuildPrepared.settledIncomplete,
      })
    }
    newSession.agent.messages = sanitizeMessagesForToolset(
      rebuildPrepared.messages,
      agent.toolNames,
    )
    this.deps.sessionStore.set(request.conversationId, newSession)
    return newSession
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
    const parts = Array.isArray(content)
      ? content
      : content &&
          typeof content === 'object' &&
          Array.isArray((content as { parts?: unknown }).parts)
        ? (content as { parts: unknown[] }).parts
        : null
    if (parts) {
      return parts
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
