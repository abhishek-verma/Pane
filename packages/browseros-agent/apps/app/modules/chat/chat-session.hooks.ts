import { useChat } from '@ai-sdk/react'
import type { ConsequenceClass } from '@browseros/shared/trust/consequence-class'
import { useQueryClient } from '@tanstack/react-query'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { compact } from 'es-toolkit/array'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import useDeepCompareEffect from 'use-deep-compare-effect'
import type { Provider } from '@/components/chat/chatComponentTypes'
import {
  getWindowConversation,
  setWindowConversation,
} from '@/lib/browseros/perWindowConversationStorage'
import { sidePanelPerWindowStorage } from '@/lib/browseros/sidePanelOpenStateStorage'
import type { ChatAction } from '@/lib/chat-actions/types'
import {
  CONVERSATION_RESET_EVENT,
  GLOW_STOP_CLICKED_EVENT,
  MESSAGE_DISLIKE_EVENT,
  MESSAGE_LIKE_EVENT,
  MESSAGE_SENT_EVENT,
  PROVIDER_SELECTED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { productFeatures } from '@/lib/constants/product-features'
import { formatConversationHistory } from '@/lib/conversations/formatConversationHistory'
import { fetchChatConversation } from '@/lib/conversations/server-chat-history'
import { declinedAppsStorage } from '@/lib/declined-apps/storage'
import { resolveChatProvider } from '@/lib/llm-providers/provider-runtime'
import { resolveStoredChatProvider } from '@/lib/llm-providers/storage'
import type { ChatRequestBrowserContext } from '@/lib/messaging/server/buildChatRequestBody'
import { track } from '@/lib/metrics/track'
import { searchActionsStorage } from '@/lib/search-actions/searchActionsStorage'
import { selectedTextStorage } from '@/lib/selected-text/selectedTextStorage'
import { sentry } from '@/lib/sentry/sentry'
import { stopAgentStorage } from '@/lib/stop-agent/stop-agent-storage'
import {
  isPoisonSessionPayload,
  stripFatInlineImagesFromMessages,
} from '@/lib/tool-evidence/strip-inline-images'
import {
  formatReplayOutputForTool,
  patchToolInvocationInput,
  patchToolInvocationOutput,
} from '@/lib/trust/patch-tool-output'
import { replayToolOnServer } from '@/lib/trust/replay-tool'
import {
  conversationTrustStorage,
  trustPinsStorage,
} from '@/lib/trust/trust-pins-storage'
import { selectedWorkspaceStorage } from '@/lib/workspace/workspace-storage'
import { useAgentServerUrl } from '@/modules/browseros/agent-server-url.hooks'
import { useInvalidateCredits } from '@/modules/credits/credits.hooks'
import { useGraphqlQuery } from '@/modules/graphql/graphql-query.hooks'
import type { ToolInvocationInfo } from '@/screens/sidepanel/index/getMessageSegments'
import { useChatRefs } from './chat-refs.hooks'
import { GetConversationWithMessagesDocument } from './chat-session-document'
import {
  buildSidepanelPreparedSendMessagesRequest,
  toProviderOption,
} from './chat-session-request'
import type { ChatMode } from './chat-types'
import {
  collectToolApprovalResponses,
  hasPendingToolApprovals,
  hasPendingToolApprovalsExcluding,
} from './collect-tool-approval-responses'
import { addContentFilterNotice } from './content-filter-notice'
import { useExecutionHistoryTracker } from './execution-history-tracker.hooks'
import { useNotifyActiveTab } from './notify-active-tab.hooks'
import { prepareMessagesForClientTurn } from './prepare-messages-for-turn'
import {
  hasApprovalRespondedParts,
  hasAssistantText,
  hydrateClientMessagesFromServer,
} from './reconcile-tool-states'
import { useRemoteConversationSave } from './remote-conversation-save.hooks'
import { toLlmProviderConfig } from './sidepanel-chat-targets'

/** How long status may stay submitted/streaming with no message growth
 *  before we ask the server whether the turn already finished. */
const STUCK_STREAM_HYDRATE_MS = 12_000

const getLastMessageText = (messages: UIMessage[]) => {
  const lastMessage = messages[messages.length - 1]
  if (!lastMessage) return ''
  return lastMessage.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

const getLastUserMessageText = (messages: UIMessage[]) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      return getLastMessageText([messages[i]])
    }
  }
  return ''
}

const getResponseAndQueryFromMessageId = (
  messages: UIMessage[],
  messageId: string,
) => {
  const messageIndex = messages.findIndex((each) => each.id === messageId)
  const response = messages?.[messageIndex] ?? []
  const query = messages?.[messageIndex - 1] ?? []
  const responseText = response.parts
    .filter((each) => each.type === 'text')
    .map((each) => each.text)
    .join('\n\n')
  const queryText = query.parts
    .filter((each) => each.type === 'text')
    .map((each) => each.text)
    .join('\n')

  return {
    responseText,
    queryText,
  }
}

export type ChatOrigin = 'sidepanel' | 'newtab'
export type AgentSessionStrategy = 'conversation' | 'main'

export interface ChatSessionOptions {
  origin?: ChatOrigin
  /** ACP agent session id source. Defaults to the conversation id. */
  agentSessionStrategy?: AgentSessionStrategy
  /** When false, messages are queued until integrations finish syncing. */
  isIntegrationsSynced?: boolean
}

const NEWTAB_SYSTEM_PROMPT = `IMPORTANT: The user is chatting from the New Tab page. When performing browser actions, ALWAYS open content in a NEW TAB rather than navigating the current tab. The user's new tab page should remain accessible.`

const getUserSystemPrompt = (
  origin: ChatOrigin | undefined,
  personalization: string,
) =>
  origin === 'newtab'
    ? [personalization, NEWTAB_SYSTEM_PROMPT].filter(Boolean).join('\n\n')
    : personalization

const buildRequestBrowserContext = ({
  activeTab,
  action,
  enabledMcpServers,
  customMcpServers,
  isPrivate,
}: {
  activeTab?: chrome.tabs.Tab
  action?: ChatAction
  enabledMcpServers: Array<string | undefined>
  customMcpServers: {
    name: string
    url?: string
  }[]
  isPrivate?: boolean
}): ChatRequestBrowserContext | undefined => {
  const browserContext: ChatRequestBrowserContext = {}

  if (activeTab) {
    browserContext.windowId = activeTab.windowId
    browserContext.activeTab = {
      id: activeTab.id,
      url: activeTab.url,
      title: activeTab.title,
    }
  }

  if (action?.tabs?.length) {
    browserContext.selectedTabs = action.tabs.map((tab) => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
    }))
  }

  const managedMcpServers = compact(enabledMcpServers)
  if (managedMcpServers.length) {
    browserContext.enabledMcpServers = managedMcpServers
  }

  if (customMcpServers.length) {
    browserContext.customMcpServers = customMcpServers
  }

  if (isPrivate === true) {
    browserContext.isPrivate = true
  }

  return Object.keys(browserContext).length ? browserContext : undefined
}

export const useChatSession = (options?: ChatSessionOptions) => {
  const {
    selectedLlmProviderRef,
    selectedChatTargetRef,
    enabledMcpServersRef,
    enabledCustomServersRef,
    personalizationRef,
    setDefaultProvider,
    chatTargets,
    selectedChatTarget,
    selectChatTarget,
    selectedLlmProvider,
    isLoadingProviders,
  } = useChatRefs()
  const invalidateCredits = useInvalidateCredits()
  const [vmStatus, setVmStatus] = useState<{
    status: 'booting' | 'error'
    progress?: string
  } | null>(null)

  const {
    baseUrl: agentServerUrl,
    isLoading: isLoadingAgentUrl,
    error: agentUrlError,
  } = useAgentServerUrl()

  const queryClient = useQueryClient()
  const {
    isLoggedIn,
    saveConversation: saveRemoteConversation,
    resetConversation: resetRemoteConversation,
    markMessagesAsSaved,
  } = useRemoteConversationSave()
  const useCloudHistory = productFeatures.cloudSync && isLoggedIn
  const [searchParams, setSearchParams] = useSearchParams()
  const conversationIdParam = searchParams.get('conversationId')

  const agentUrlRef = useRef(agentServerUrl)
  const agentUrlErrorRef = useRef(agentUrlError)

  useEffect(() => {
    agentUrlRef.current = agentServerUrl
  }, [agentServerUrl])

  useEffect(() => {
    agentUrlErrorRef.current = agentUrlError
  }, [agentUrlError])

  const providers: Provider[] = chatTargets.map(toProviderOption)

  const [mode, setMode] = useState<ChatMode>('agent')
  const [textToAction, setTextToAction] = useState<Map<string, ChatAction>>(
    new Map(),
  )
  const [liked, setLiked] = useState<Record<string, boolean>>({})
  const [disliked, setDisliked] = useState<Record<string, boolean>>({})
  const [conversationId, setConversationId] = useState(crypto.randomUUID())
  const conversationIdRef = useRef(conversationId)
  // The window this panel belongs to, resolved on mount in per-window scope.
  const windowIdRef = useRef<number | null>(null)

  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const {
    startTask: startExecutionTask,
    syncFromMessages: syncExecutionHistory,
    finishTask: finishExecutionTask,
  } = useExecutionHistoryTracker()

  const onClickLike = (messageId: string) => {
    const { responseText, queryText } = getResponseAndQueryFromMessageId(
      messages,
      messageId,
    )

    track(MESSAGE_LIKE_EVENT, { responseText, queryText, messageId })

    setLiked((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }))
  }

  const onClickDislike = (messageId: string, comment?: string) => {
    const { responseText, queryText } = getResponseAndQueryFromMessageId(
      messages,
      messageId,
    )

    track(MESSAGE_DISLIKE_EVENT, {
      responseText,
      queryText,
      messageId,
      comment,
    })

    setDisliked((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }))
  }

  const modeRef = useRef<ChatMode>(mode)
  const textToActionRef = useRef<Map<string, ChatAction>>(textToAction)
  const workingDirRef = useRef<string | undefined>(undefined)
  const workspaceIdRef = useRef<string | undefined>(undefined)
  const bucketIdRef = useRef<string | undefined>(undefined)
  const trustPinsRef = useRef<
    Record<string, { pinned: boolean; expiresAt?: number }>
  >({})
  const selectionMapRef = useRef<
    Record<string, { text: string; url: string; title: string }>
  >({})
  const pendingSelectionTabKeyRef = useRef<string | null>(null)
  const messagesRef = useRef<UIMessage[]>([])

  useEffect(() => {
    const toRef = (
      map: Record<string, { text: string; pageUrl: string; pageTitle: string }>,
    ) => {
      const result: Record<
        string,
        { text: string; url: string; title: string }
      > = {}
      for (const [k, v] of Object.entries(map)) {
        result[k] = { text: v.text, url: v.pageUrl, title: v.pageTitle }
      }
      return result
    }
    selectedTextStorage.getValue().then((map) => {
      selectionMapRef.current = toRef(map)
    })
    const unwatchText = selectedTextStorage.watch((map) => {
      selectionMapRef.current = toRef(map)
    })
    return () => unwatchText()
  }, [])

  useEffect(() => {
    selectedWorkspaceStorage.getValue().then((folder) => {
      workingDirRef.current = folder?.path
      workspaceIdRef.current = folder?.id
      bucketIdRef.current = folder?.bucketId
    })
    trustPinsStorage.getValue().then((pins) => {
      trustPinsRef.current = pins ?? {}
    })

    const unwatch = selectedWorkspaceStorage.watch((folder) => {
      workingDirRef.current = folder?.path
      workspaceIdRef.current = folder?.id
      bucketIdRef.current = folder?.bucketId
    })
    const unwatchPins = trustPinsStorage.watch((pins) => {
      trustPinsRef.current = pins ?? {}
    })
    return () => {
      unwatch()
      unwatchPins()
    }
  }, [])

  useDeepCompareEffect(() => {
    modeRef.current = mode
    textToActionRef.current = textToAction
  }, [mode, textToAction])

  const selectedProvider = selectedChatTarget
    ? toProviderOption(selectedChatTarget)
    : providers[0]

  const {
    messages,
    sendMessage: baseSendMessage,
    setMessages,
    status,
    stop,
    error: chatError,
    addToolApprovalResponse,
    clearError,
    regenerate,
  } = useChat({
    // The AI SDK does not auto-resume after `addToolApprovalResponse` unless
    // `sendAutomaticallyWhen` is configured. Without this, approving/denying a
    // consequential tool only flips the local part to `approval-responded` and
    // never sends the resume request, so the server never re-executes the
    // approved tool (and the model never sees the result). Resume whenever the
    // last message carries a tool part the user just responded to.
    sendAutomaticallyWhen: ({ messages }) => {
      // ACP harness chat does not apply Pane toolApprovalResponses; auto-resume
      // would POST an empty message and 400. Approvals only resume on LLM /chat.
      if (selectedChatTargetRef.current?.kind === 'acp') return false
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role !== 'assistant' || !lastMessage.parts) return false

      let hasAnyResponded = false
      for (const part of lastMessage.parts) {
        if (!part.type) continue
        const isTool =
          part.type === 'dynamic-tool' || part.type.startsWith('tool-')
        if (!isTool) continue
        const toolPart = part as { state: string }
        // If ANY tool is still waiting for approval, hold off — resuming now
        // would send approval-requested state to the server loop which causes
        // a TypeValidationError when multiple tools need approval simultaneously.
        if (toolPart.state === 'approval-requested') return false
        if (toolPart.state === 'approval-responded') hasAnyResponded = true
      }
      return hasAnyResponded
    },
    transport: new DefaultChatTransport({
      prepareSendMessagesRequest: async ({ messages }) => {
        const target = selectedChatTargetRef.current
        const fallbackProvider =
          resolveChatProvider(
            selectedLlmProviderRef.current
              ? [selectedLlmProviderRef.current]
              : [],
          ) ?? (await resolveStoredChatProvider())
        if (!fallbackProvider) {
          throw new Error(
            'No AI provider configured. Add one in Settings → AI & Agents.',
          )
        }
        const activeTabsList = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
        const activeTab = activeTabsList?.[0] ?? undefined
        const activeTabSelection = activeTab?.id
          ? (selectionMapRef.current[String(activeTab.id)] ?? null)
          : null
        let isPrivate: boolean | undefined
        if (activeTab?.windowId != null) {
          try {
            const win = await chrome.windows.get(activeTab.windowId)
            isPrivate = win.incognito === true
          } catch {
            // Window may have closed between query and get; omit the flag.
          }
        }
        const currentMode = modeRef.current
        const enabledMcpServers = enabledMcpServersRef.current
        const customMcpServers = enabledCustomServersRef.current
        const lastUserMessage = getLastUserMessageText(messages)
        const action = textToActionRef.current.get(lastUserMessage)
        const requestBrowserContext = buildRequestBrowserContext({
          activeTab,
          action,
          enabledMcpServers,
          customMcpServers,
          isPrivate,
        })

        const declinedApps = await declinedAppsStorage.getValue()
        const previousMessages = messagesRef.current
        const history =
          previousMessages.length > 0
            ? formatConversationHistory(previousMessages)
            : undefined
        const previousConversation = history?.length ? history : undefined

        // Approval decisions to replay on the server (see
        // `collectToolApprovalResponses`). Sent on resume turns so the server
        // can update its stored tool parts and re-run the loop.
        const toolApprovalResponses = collectToolApprovalResponses(messages)
        const isApprovalResume = toolApprovalResponses.length > 0

        const userSystemPrompt = getUserSystemPrompt(
          options?.origin,
          personalizationRef.current,
        )
        const agentSessionStrategy =
          options?.agentSessionStrategy ?? 'conversation'
        const agentSessionId =
          agentSessionStrategy === 'main' ? 'main' : conversationIdRef.current

        // Read pins from storage (not only the ref) so "Allow always" that
        // just wrote to storage is included in this same approval-resume
        // request. The ref can lag one tick behind storage.watch.
        const convoPins = await conversationTrustStorage.getValue()
        const activeConvoPins = convoPins[conversationIdRef.current] ?? {}
        const storedPins = await trustPinsStorage.getValue()
        trustPinsRef.current = storedPins ?? {}
        const mergedPins = { ...trustPinsRef.current }
        for (const [cls, isTrusted] of Object.entries(activeConvoPins)) {
          if (isTrusted) {
            mergedPins[cls as ConsequenceClass] = { pinned: true }
          }
        }

        const commonRequest = {
          conversationId: conversationIdRef.current,
          agentSessionId,
          mode: currentMode,
          browserContext: requestBrowserContext,
          userSystemPrompt,
          userWorkingDir: workingDirRef.current,
          workspaceId: workspaceIdRef.current,
          bucketId: bucketIdRef.current ?? 'default',
          trustPins: mergedPins,
          previousConversation,
          declinedApps,
          toolApprovalResponses,
        }

        const message = isApprovalResume ? '' : getLastUserMessageText(messages)

        const currentAgentServerUrl = agentUrlRef.current
        if (!currentAgentServerUrl) {
          throw (
            agentUrlErrorRef.current ??
            new Error('Agent server URL not configured.')
          )
        }

        const result = buildSidepanelPreparedSendMessagesRequest({
          agentServerUrl: currentAgentServerUrl,
          target,
          fallbackProvider,
          message,
          ...commonRequest,
          selectedText: activeTabSelection?.text,
          selectedTextSource: activeTabSelection
            ? {
                url: activeTabSelection.url,
                title: activeTabSelection.title,
              }
            : undefined,
        })

        // Track which tab's selection was sent so we can clear it on success
        pendingSelectionTabKeyRef.current =
          activeTabSelection && activeTab?.id ? String(activeTab.id) : null

        return result
      },
    }),
    onData: (part) => {
      if (part.type !== 'data-vm-status') return
      const data = part.data as
        | { status?: string; progress?: string }
        | undefined
      const status = data?.status
      if (!status || status === 'running') {
        setVmStatus(null)
        return
      }
      setVmStatus({
        status: status as 'booting' | 'error',
        progress: data?.progress,
      })
    },
    onFinish: async ({ message, messages, isAbort, isError, finishReason }) => {
      setVmStatus(null)
      const nextMessages = addContentFilterNotice(
        messages,
        message,
        finishReason,
      )
      if (nextMessages !== messages) {
        setMessages(nextMessages)
      }
      const responseMessage =
        nextMessages.find((each) => each.id === message.id) ?? message
      await finishExecutionTask({
        responseText: getLastMessageText([responseMessage]),
        isAbort,
        isError,
      })
    },
  })

  // `addToolApprovalResponse` flips the tool part to `approval-responded`
  // synchronously but only kicks off the actual resume request (and the
  // `status` transition to 'submitted') after a couple of microtask ticks
  // (`this.jobExecutor.run` + the async `shouldSendAutomatically` check).
  // `status` briefly still reads 'ready' in that window, so a fast second
  // click on Send would race the resume request against a brand-new turn
  // mutating the same transcript. This flag closes that window; the server
  // mutex is the second line of defense if it is ever missed.
  const [approvalResumeInFlight, setApprovalResumeInFlight] = useState(false)
  // Ref so Approve/Deny handlers always read the live gate even if a memoized
  // message row still holds a stale callback identity from a prior render.
  const approvalResumeInFlightRef = useRef(false)
  approvalResumeInFlightRef.current = approvalResumeInFlight
  const prevStatusRef = useRef(status)
  useEffect(() => {
    // Once the SDK actually starts the resume, `status` takes over as the
    // busy signal.
    if (status !== 'ready') {
      setApprovalResumeInFlight(false)
      return
    }
    // sendAutomaticallyWhen withholds the resume while any sibling tool is
    // still approval-requested, so status stays 'ready' after the first
    // Approve/Deny. Clear the flag in that case or the remaining cards
    // silently no-op (approveTool/denyTool early-return) and canSend stays
    // false until reload.
    if (approvalResumeInFlight && hasPendingToolApprovals(messages)) {
      setApprovalResumeInFlight(false)
    }
  }, [status, messages, approvalResumeInFlight])

  // When a turn settles, the SSE merge can leave the client behind the
  // server transcript: stuck `approval-responded` cards, or a completed
  // tool+text assistant turn the UI never painted (silent reply). Hydrate
  // from SQLite once we go idle.
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    const becameIdle =
      (prev === 'submitted' || prev === 'streaming') &&
      (status === 'ready' || status === 'error')
    if (!becameIdle) return
    const conversationId = conversationIdRef.current
    const baseUrl = agentUrlRef.current
    if (!conversationId || !baseUrl) return
    let cancelled = false
    void fetchChatConversation(conversationId, baseUrl)
      .then((detail) => {
        if (cancelled) return
        setMessages((current) => {
          const { messages: next } = hydrateClientMessagesFromServer(
            current,
            detail.messages,
          )
          return next
        })
      })
      .catch(() => {
        // Best-effort; Retry / silent-reply stay until the next turn.
      })
    return () => {
      cancelled = true
    }
  }, [status, setMessages])

  // Safety net when status never settles (SSE finish dropped but server
  // already checkpointed). Track message growth; if the transcript is
  // idle while status stays submitted/streaming, fetch SQLite and hydrate.
  const stuckHydrateInFlightRef = useRef(false)
  const lastMessageGrowthAtRef = useRef(Date.now())
  const messagesGrowthKey = `${messages.length}:${messages[messages.length - 1]?.id ?? ''}:${messages[messages.length - 1]?.parts?.length ?? 0}`
  useEffect(() => {
    // messagesGrowthKey is the intentional trigger: any transcript growth
    // resets the stuck-stream quiet window.
    void messagesGrowthKey
    lastMessageGrowthAtRef.current = Date.now()
  }, [messagesGrowthKey])

  useEffect(() => {
    const busy = status === 'submitted' || status === 'streaming'
    if (!busy) {
      stuckHydrateInFlightRef.current = false
      return
    }
    const conversationId = conversationIdRef.current
    const baseUrl = agentUrlRef.current
    if (!conversationId || !baseUrl) return

    let cancelled = false
    const timer = setInterval(() => {
      if (cancelled || stuckHydrateInFlightRef.current) return
      if (
        Date.now() - lastMessageGrowthAtRef.current <
        STUCK_STREAM_HYDRATE_MS
      ) {
        return
      }
      stuckHydrateInFlightRef.current = true
      void fetchChatConversation(conversationId, baseUrl)
        .then((detail) => {
          if (cancelled) return
          // Require assistant text so a mid-turn onStepFinish checkpoint
          // (tools done, next model step still running) cannot abort a live
          // agent loop. Idle hydrate (becameIdle) covers tool-only finals.
          const serverAssistant = [...detail.messages]
            .reverse()
            .find((m) => m.role === 'assistant')
          if (!hasAssistantText(serverAssistant)) {
            // Still mid-turn on the server; wait another quiet window.
            lastMessageGrowthAtRef.current = Date.now()
            return
          }

          let hydrated = false
          setMessages((current) => {
            const result = hydrateClientMessagesFromServer(
              current,
              detail.messages,
            )
            hydrated = result.hydratedAssistantTurn
            return result.messages
          })
          if (hydrated) {
            // Abort the orphaned SSE so status can leave submitted/streaming.
            // Prefer stop() over stopAndSettle: server already finished, and
            // settle would falsely deny any approval-responded parts.
            void stop()
            clearError()
          } else {
            // Client already matches; avoid fetch-spamming while still busy.
            lastMessageGrowthAtRef.current = Date.now()
          }
        })
        .catch(() => {
          lastMessageGrowthAtRef.current = Date.now()
        })
        .finally(() => {
          stuckHydrateInFlightRef.current = false
        })
    }, 2_000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [status, setMessages, stop, clearError])

  // Disabled while: agent URL isn't ready, a turn is in flight, a resume
  // was just triggered but hasn't flipped `status` yet, or an approval
  // card is still waiting on the user. Sending while status is still
  // submitted/streaming orphans the prior activeResponse in AI SDK
  // (makeRequest overwrites it without abort) and is how silent-reply
  // desyncs deepen into a second turn.
  const canSend =
    !isLoadingAgentUrl &&
    !agentUrlError &&
    !!agentServerUrl &&
    (status === 'ready' || status === 'error') &&
    !approvalResumeInFlight &&
    !hasPendingToolApprovals(messages)

  // A Stop click (or the cross-window stopAgentStorage signal) can land
  // mid-tool-call, leaving an input-available/input-streaming part with no
  // result. Settle those locally so the card does not look permanently
  // "running" and the next message does not round-trip a dangling tool-call
  // into MissingToolResultsError on the server.
  //
  // During an approval resume, do NOT force-deny already-approved
  // (`approval-responded`) parts — the server may have already executed them.
  // Settle unanswered approvals only, then reconcile from the server transcript.
  const stopAndSettle = useCallback(() => {
    stop()
    // Stop aborts the in-flight resume SSE; clear the local gate so Retry
    // is not treated as a second click against a still-"running" resume.
    setApprovalResumeInFlight(false)
    const hadResponded = hasApprovalRespondedParts(messagesRef.current)
    setMessages((current) =>
      prepareMessagesForClientTurn(current, {
        settleApprovals: 'requested-only',
        approvalReason: 'Interrupted before approval',
        incompleteReason: 'Interrupted before the tool finished',
      }),
    )
    if (!hadResponded) return
    const conversationId = conversationIdRef.current
    const baseUrl = agentUrlRef.current
    if (!conversationId || !baseUrl) return
    void fetchChatConversation(conversationId, baseUrl)
      .then((detail) => {
        setMessages((current) => {
          const { messages: next } = hydrateClientMessagesFromServer(
            current,
            detail.messages,
          )
          return next
        })
      })
      .catch(() => {
        // Best-effort; stuck approval-responded keeps the Retry UI.
      })
  }, [stop, setMessages])

  // "Try again" on a ChatError card. Settle any orphaned tool/approval parts
  // the failed turn left behind, clear the error so status flips back to
  // ready, then regenerate — this drops the poisoned last assistant message
  // and resends the last user message through the normal transport path.
  const retryLastTurn = useCallback(() => {
    setMessages((current) => prepareMessagesForClientTurn(current))
    clearError()
    void regenerate()
  }, [setMessages, clearError, regenerate])

  // Remove messages with empty parts (e.g. interrupted assistant responses)
  // to prevent AI SDK validation errors on subsequent sends. Skip while a
  // turn is in flight — an assistant shell can briefly have empty parts
  // between the stream start chunk and the first content part.
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return
    if (messages.some((m) => !m.parts?.length)) {
      setMessages(messages.filter((m) => m.parts?.length > 0))
    }
  }, [messages, status, setMessages])

  useNotifyActiveTab({
    messages,
    status,
    conversationId: conversationIdRef.current,
  })

  const {
    data: remoteConversationData,
    isFetched: isRemoteConversationFetched,
  } = useGraphqlQuery(
    GetConversationWithMessagesDocument,
    { conversationId: conversationIdParam ?? '' },
    {
      enabled: !!conversationIdParam && useCloudHistory,
    },
  )

  const [restoredConversationId, setRestoredConversationId] = useState<
    string | null
  >(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore should only run when query data arrives or conversationIdParam changes
  useEffect(() => {
    if (!conversationIdParam) return
    if (restoredConversationId === conversationIdParam) return

    // Loading a different conversation while this one is still streaming
    // would otherwise leave that stream running against a swapped-out
    // conversationId and land its tool parts on the wrong transcript.
    stop()

    const quarantineAndOpenBlank = (reason: string) => {
      sentry.captureMessage(reason, {
        level: 'warning',
        extra: { conversationId: conversationIdParam },
      })
      setRestoredConversationId(conversationIdParam)
      setSearchParams({}, { replace: true })
      setMessages([])
      setConversationId(crypto.randomUUID())
    }

    if (useCloudHistory) {
      if (!isRemoteConversationFetched) return

      if (remoteConversationData?.conversation) {
        const restoredMessages = stripFatInlineImagesFromMessages(
          remoteConversationData.conversation.conversationMessages.nodes
            .filter((node): node is NonNullable<typeof node> => node !== null)
            .map((node) => node.message as UIMessage),
        )
        if (isPoisonSessionPayload(restoredMessages)) {
          quarantineAndOpenBlank(
            'chat.restore.quarantined_oversized_conversation',
          )
          return
        }

        // History restore must not force-deny already-answered approvals.
        // Default settle turns stop-raced `approval-responded` into a false
        // `output-denied` even when the tool side effect already ran.
        const preparedMessages = prepareMessagesForClientTurn(
          restoredMessages,
          { settleApprovals: false },
        )
        setConversationId(
          conversationIdParam as ReturnType<typeof crypto.randomUUID>,
        )
        setMessages(preparedMessages)
        markMessagesAsSaved(conversationIdParam, preparedMessages)
      }
      setRestoredConversationId(conversationIdParam)
      setSearchParams({}, { replace: true })
      return
    }

    const restoreFromServer = async () => {
      try {
        const baseUrl = agentUrlRef.current
        if (!baseUrl) {
          // Keep conversationId in the URL until the agent URL resolves so the
          // effect can retry; do not mark restored or clear the query param.
          return
        }
        const conversation = await fetchChatConversation(
          conversationIdParam,
          baseUrl,
        )
        const safeMessages = stripFatInlineImagesFromMessages(
          conversation.messages,
        )
        // Poison-session safe open: if the payload is still enormous after
        // stripping images, start a blank chat instead of crash-looping.
        if (isPoisonSessionPayload(safeMessages)) {
          quarantineAndOpenBlank(
            'chat.restore.quarantined_oversized_conversation',
          )
          return
        }
        setConversationId(
          conversation.id as ReturnType<typeof crypto.randomUUID>,
        )
        setMessages(
          prepareMessagesForClientTurn(safeMessages, {
            settleApprovals: false,
          }),
        )
        setRestoredConversationId(conversationIdParam)
        setSearchParams({}, { replace: true })
      } catch (error) {
        sentry.captureException(error)
        // Safe open: clear the deep-link so we do not crash-loop the same id.
        setRestoredConversationId(conversationIdParam)
        setSearchParams({}, { replace: true })
        setMessages([])
        setConversationId(crypto.randomUUID())
      }
    }
    void restoreFromServer()
  }, [
    conversationIdParam,
    remoteConversationData,
    useCloudHistory,
    isRemoteConversationFetched,
    agentServerUrl,
  ])

  // Per-window scope: resume this window's conversation when the panel
  // (re)mounts (e.g. closed + reopened) instead of starting a blank chat.
  // No-op in per-tab scope. Tab switches keep the same panel instance, so this
  // only matters for a fresh mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; reads refs
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!(await sidePanelPerWindowStorage.getValue())) return
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const windowId = tab?.windowId
      if (windowId == null || cancelled) return
      windowIdRef.current = windowId
      const stored = await getWindowConversation(windowId)
      if (cancelled) return
      if (stored && stored !== conversationIdRef.current) {
        setSearchParams({ conversationId: stored })
      } else if (!stored) {
        await setWindowConversation(windowId, conversationIdRef.current)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Remember the conversation this window is on so a remount can resume it.
  useEffect(() => {
    const windowId = windowIdRef.current
    if (windowId == null) return
    ;(async () => {
      if (!(await sidePanelPerWindowStorage.getValue())) return
      await setWindowConversation(windowId, conversationId)
    })()
  }, [conversationId])

  // Keep messagesRef in sync on every change (cheap ref assignment)
  useEffect(() => {
    messagesRef.current = messages
    syncExecutionHistory(messages, status)
  }, [messages, status, syncExecutionHistory])

  // Save conversation only after streaming completes — not on every token
  const previousStatusRef = useRef(status)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only save when streaming finishes
  useEffect(() => {
    const wasStreaming =
      previousStatusRef.current === 'streaming' ||
      previousStatusRef.current === 'submitted'
    const justFinished = wasStreaming && status === 'ready'
    previousStatusRef.current = status

    if (!justFinished) return

    // Clear the selected text that was sent with this request
    const tabKey = pendingSelectionTabKeyRef.current
    if (tabKey) {
      pendingSelectionTabKeyRef.current = null
      delete selectionMapRef.current[tabKey]
      selectedTextStorage.getValue().then((map) => {
        if (map[tabKey]) {
          const { [tabKey]: _, ...rest } = map
          selectedTextStorage.setValue(rest)
        }
      })
    }

    const messagesToSave = messages.filter((m) => m.parts?.length > 0)
    if (messagesToSave.length === 0) return

    // Server SQLite already persists on turn finish. Only dual-write to
    // GraphQL when cloud sync is enabled; never write transcripts to
    // chrome.storage (M1.5 source-of-truth).
    if (useCloudHistory) {
      saveRemoteConversation(conversationIdRef.current, messagesToSave)
    }
    void queryClient.invalidateQueries({
      queryKey: ['sidepanel-chat-history'],
    })

    invalidateCredits()
  }, [status])

  useEffect(() => {
    if (chatError) invalidateCredits()
  }, [chatError, invalidateCredits])

  const isIntegrationsSynced = options?.isIntegrationsSynced ?? true
  const isIntegrationsSyncedRef = useRef(isIntegrationsSynced)
  const pendingMessageRef = useRef<{
    text: string
    action?: ChatAction
  } | null>(null)

  const trackMessageSent = useCallback(() => {
    const target = selectedChatTargetRef.current
    const llmTargetProvider = toLlmProviderConfig(target)
    const agentTarget = target?.kind === 'acp' ? target : undefined
    track(MESSAGE_SENT_EVENT, {
      mode,
      provider_id:
        agentTarget?.agentId ??
        llmTargetProvider?.id ??
        selectedLlmProvider?.id,
      provider_type: agentTarget ? 'acp' : llmTargetProvider?.type,
      agent_id: agentTarget?.agentId,
      adapter: agentTarget?.adapter,
      model:
        agentTarget?.modelId ??
        llmTargetProvider?.modelId ??
        selectedLlmProvider?.modelId,
    })
  }, [mode, selectedChatTargetRef, selectedLlmProvider])

  const dispatchMessage = useCallback(
    (text: string) => {
      trackMessageSent()
      startExecutionTask({
        conversationId: conversationIdRef.current,
        promptText: text,
      })
      // AI SDK makeRequest overwrites activeResponse without aborting the
      // prior fetch. Abort any wedged stream first so a new turn cannot
      // orphan the previous SSE consumer (silent-reply desync family).
      if (status === 'submitted' || status === 'streaming') {
        void stop()
      }
      // New user turns supersede pending Approve/Deny cards and any tool left
      // mid-flight by a prior Stop/abort. Settle both locally so the UI drops
      // the cards, and the server settles its session copy to avoid
      // MissingToolResultsError. Do not use addToolApprovalResponse here — that
      // would trigger an empty approval-resume via sendAutomaticallyWhen.
      setMessages((current) => prepareMessagesForClientTurn(current))
      baseSendMessage({ text })
    },
    [
      baseSendMessage,
      setMessages,
      startExecutionTask,
      status,
      stop,
      trackMessageSent,
    ],
  )

  useEffect(() => {
    isIntegrationsSyncedRef.current = isIntegrationsSynced
  }, [isIntegrationsSynced])

  useEffect(() => {
    if (isIntegrationsSynced && agentServerUrl && pendingMessageRef.current) {
      const pending = pendingMessageRef.current
      pendingMessageRef.current = null
      const { action } = pending
      if (action) {
        setTextToAction((prev) => {
          const next = new Map(prev)
          next.set(pending.text, action)
          return next
        })
      }
      dispatchMessage(pending.text)
    }
  }, [agentServerUrl, dispatchMessage, isIntegrationsSynced])

  const sendMessage = (params: { text: string; action?: ChatAction }) => {
    if (!isIntegrationsSyncedRef.current || !agentUrlRef.current) {
      pendingMessageRef.current = params
      return
    }

    if (params.action) {
      const action = params.action
      setTextToAction((prev) => {
        const next = new Map(prev)
        next.set(params.text, action)
        return next
      })
    }
    dispatchMessage(params.text)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: only need to run this once
  useEffect(() => {
    const unwatch = searchActionsStorage.watch((storageAction) => {
      if (storageAction) {
        resetConversationState()
        setMode(storageAction.mode)
        setTimeout(() => {
          sendMessage({
            text: storageAction.query,
            action: storageAction.action,
          })
        }, 0)
        searchActionsStorage.setValue(null)
      }
    })
    return () => unwatch()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only need to run this once
  useEffect(() => {
    const unwatch = stopAgentStorage.watch((signal) => {
      if (signal && signal.conversationId === conversationIdRef.current) {
        stopAndSettle()
        track(GLOW_STOP_CLICKED_EVENT)
        stopAgentStorage.setValue(null)
      }
    })
    return () => unwatch()
  }, [])

  const resetConversationState = () => {
    stop()
    void finishExecutionTask({ isAbort: true })
    const nextConvoId = crypto.randomUUID()
    setConversationId(nextConvoId)
    conversationIdRef.current = nextConvoId
    setMessages([])
    setTextToAction(new Map())
    setLiked({})
    setDisliked({})
    setRestoredConversationId(null)
    resetRemoteConversation()
  }

  const handleSelectProvider = (provider: Provider) => {
    const target = chatTargets.find(
      (candidate) =>
        candidate.id === provider.id && candidate.kind === provider.kind,
    )
    if (!target) return

    const previousTarget = selectedChatTargetRef.current
    track(PROVIDER_SELECTED_EVENT, {
      provider_id: target.id,
      provider_type: target.kind === 'acp' ? 'acp' : target.type,
      model_id:
        target.kind === 'acp' ? target.modelId : target.provider.modelId,
      agent_id: target.kind === 'acp' ? target.agentId : undefined,
      adapter: target.kind === 'acp' ? target.adapter : undefined,
    })

    void selectChatTarget(target).catch((error) => {
      sentry.captureException(error, {
        extra: {
          message: 'Failed to persist sidepanel chat target selection',
          targetId: target.id,
          targetKind: target.kind,
        },
      })
    })
    if (target.kind === 'llm') setDefaultProvider(target.provider.id)

    if (
      previousTarget &&
      (previousTarget.kind !== target.kind ||
        previousTarget.id !== target.id) &&
      messagesRef.current.length > 0
    ) {
      resetConversationState()
    }
  }

  const getActionForMessage = (message: UIMessage) => {
    if (message.role !== 'user') return undefined
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('')
    return textToAction.get(text)
  }

  const resetConversation = () => {
    track(CONVERSATION_RESET_EVENT, { message_count: messages.length })
    resetConversationState()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: MCP server refs are stable containers read at call time
  const executeToolReplay = useCallback(
    async (
      tool: ToolInvocationInfo,
      args: Record<string, unknown>,
      options?: { dismissApprovalId?: string },
    ) => {
      const baseUrl = agentUrlRef.current
      if (!baseUrl) {
        throw new Error('Agent server URL not configured.')
      }

      const activeTabsList = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const activeTab = activeTabsList?.[0]
      let isPrivate: boolean | undefined
      if (activeTab?.windowId != null) {
        try {
          const win = await chrome.windows.get(activeTab.windowId)
          isPrivate = win.incognito === true
        } catch {
          // Window may have closed between query and get; omit the flag.
        }
      }
      const browserContext = buildRequestBrowserContext({
        activeTab,
        action: undefined,
        enabledMcpServers: enabledMcpServersRef.current,
        customMcpServers: enabledCustomServersRef.current,
        isPrivate,
      })

      const convoPins = await conversationTrustStorage.getValue()
      const activeConvoPins = convoPins[conversationIdRef.current] ?? {}
      const storedPins = await trustPinsStorage.getValue()
      trustPinsRef.current = storedPins ?? {}
      const mergedPins = { ...trustPinsRef.current }
      for (const [cls, isTrusted] of Object.entries(activeConvoPins)) {
        if (isTrusted) {
          mergedPins[cls as ConsequenceClass] = { pinned: true }
        }
      }

      const result = await replayToolOnServer(baseUrl, {
        toolName: tool.toolName,
        args,
        conversationId: conversationIdRef.current,
        toolCallId: tool.toolCallId,
        userWorkingDir: workingDirRef.current,
        workspaceId: workspaceIdRef.current,
        bucketId: bucketIdRef.current ?? 'default',
        trustPins: mergedPins,
        browserContext,
      })

      const formatted = formatReplayOutputForTool(tool, result.output)
      setMessages((current) =>
        patchToolInvocationOutput(
          current,
          tool.toolCallId,
          formatted,
          result.isError,
        ),
      )

      if (options?.dismissApprovalId) {
        addToolApprovalResponse?.({
          id: options.dismissApprovalId,
          approved: false,
        })
      }
    },
    [addToolApprovalResponse, setMessages],
  )

  const approveTool = useCallback(
    async (
      approvalId: string,
      tool: ToolInvocationInfo,
      args: Record<string, unknown>,
    ) => {
      // A second Approve/Retry while a resume is already in flight aborts the
      // first SSE stream in useChat, which is exactly how local parts get
      // stuck at approval-responded after the server already finished.
      if (approvalResumeInFlightRef.current) return

      // Retry path: the part is already approval-responded. Prefer syncing
      // from the server first — often the action already ran and only the
      // local UI is stale. Re-POSTing in that case just storms resumes.
      if (tool.state === 'approval-responded') {
        const conversationId = conversationIdRef.current
        const baseUrl = agentUrlRef.current
        if (conversationId && baseUrl) {
          try {
            const detail = await fetchChatConversation(conversationId, baseUrl)
            let thisToolStillStuck = true
            setMessages((current) => {
              const { messages: next } = hydrateClientMessagesFromServer(
                current,
                detail.messages,
              )
              for (const message of next) {
                if (message.role !== 'assistant') continue
                for (const part of message.parts ?? []) {
                  if (
                    part &&
                    typeof part === 'object' &&
                    'toolCallId' in part &&
                    (part as { toolCallId?: string }).toolCallId ===
                      tool.toolCallId &&
                    (part as { state?: string }).state !== 'approval-responded'
                  ) {
                    thisToolStillStuck = false
                  }
                }
              }
              return next
            })
            if (!thisToolStillStuck) return
          } catch {
            // Fall through to a real resume attempt.
          }
        }
      }

      const argsChanged =
        JSON.stringify(args) !== JSON.stringify(tool.input ?? {})
      if (argsChanged) {
        // Patch the edited args into the tool invocation before resuming the
        // loop. The server re-executes the tool with the patched input and the
        // model sees the real result — no side-channel replay, so the model's
        // context never diverges from what actually happened.
        setMessages((current) =>
          patchToolInvocationInput(current, tool.toolCallId, args),
        )
      }
      // Arm the resume gate only when this answer unblocks sendAutomaticallyWhen.
      // Answering the first of N siblings must not leave the flag true while
      // status stays 'ready' — that stuck a memoized Approve handler as a no-op.
      if (
        !hasPendingToolApprovalsExcluding(messagesRef.current, tool.toolCallId)
      ) {
        setApprovalResumeInFlight(true)
      }
      addToolApprovalResponse?.({ id: approvalId, approved: true })
    },
    [addToolApprovalResponse, setMessages],
  )

  const denyTool = useCallback(
    (approvalId: string) => {
      if (approvalResumeInFlightRef.current) return
      let toolCallId: string | undefined
      for (const message of messagesRef.current) {
        if (message.role !== 'assistant') continue
        for (const part of message.parts ?? []) {
          if (
            part &&
            typeof part === 'object' &&
            'approval' in part &&
            (part as { approval?: { id?: string } }).approval?.id ===
              approvalId &&
            'toolCallId' in part
          ) {
            toolCallId = (part as { toolCallId?: string }).toolCallId
          }
        }
      }
      if (!hasPendingToolApprovalsExcluding(messagesRef.current, toolCallId)) {
        setApprovalResumeInFlight(true)
      }
      addToolApprovalResponse?.({ id: approvalId, approved: false })
    },
    [addToolApprovalResponse],
  )

  const promoteTool = useCallback(
    async (tool: ToolInvocationInfo, args: Record<string, unknown>) => {
      await executeToolReplay(tool, args)
    },
    [executeToolReplay],
  )

  const isRestoringConversation =
    !!conversationIdParam && restoredConversationId !== conversationIdParam

  return {
    mode,
    setMode,
    messages,
    sendMessage,
    status,
    stop: stopAndSettle,
    retryLastTurn,
    providers,
    selectedProvider,
    isLoading: isLoadingProviders || isLoadingAgentUrl,
    canSend,
    approvalResumeInFlight,
    isSyncing: !isIntegrationsSynced,
    isRestoringConversation,
    agentUrlError,
    chatError,
    handleSelectProvider,
    getActionForMessage,
    resetConversation,
    liked,
    onClickLike,
    disliked,
    onClickDislike,
    conversationId,
    vmStatus,
    addToolApprovalResponse,
    approveTool,
    denyTool,
    promoteTool,
  }
}
