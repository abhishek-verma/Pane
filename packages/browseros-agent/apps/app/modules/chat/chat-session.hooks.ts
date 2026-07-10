import { useChat } from '@ai-sdk/react'
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
  formatReplayOutputForTool,
  patchToolInvocationInput,
  patchToolInvocationOutput,
} from '@/lib/trust/patch-tool-output'
import { replayToolOnServer } from '@/lib/trust/replay-tool'
import { trustPinsStorage } from '@/lib/trust/trust-pins-storage'
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
import { collectToolApprovalResponses } from './collect-tool-approval-responses'
import { addContentFilterNotice } from './content-filter-notice'
import { useExecutionHistoryTracker } from './execution-history-tracker.hooks'
import { useNotifyActiveTab } from './notify-active-tab.hooks'
import { useRemoteConversationSave } from './remote-conversation-save.hooks'
import { toLlmProviderConfig } from './sidepanel-chat-targets'

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

  const canSend = !isLoadingAgentUrl && !agentUrlError && !!agentServerUrl

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
  } = useChat({
    // The AI SDK does not auto-resume after `addToolApprovalResponse` unless
    // `sendAutomaticallyWhen` is configured. Without this, approving/denying a
    // consequential tool only flips the local part to `approval-responded` and
    // never sends the resume request, so the server never re-executes the
    // approved tool (and the model never sees the result). Resume whenever the
    // last message carries a tool part the user just responded to.
    sendAutomaticallyWhen: ({ messages }) => {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role !== 'assistant' || !lastMessage.parts) return false
      return lastMessage.parts.some((part) => {
        if (!part.type) return false
        const isTool =
          part.type === 'dynamic-tool' || part.type.startsWith('tool-')
        if (!isTool) return false
        const toolPart = part as { state: string }
        return toolPart.state === 'approval-responded'
      })
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

        const commonRequest = {
          conversationId: conversationIdRef.current,
          agentSessionId,
          mode: currentMode,
          browserContext: requestBrowserContext,
          userSystemPrompt,
          userWorkingDir: workingDirRef.current,
          workspaceId: workspaceIdRef.current,
          bucketId: bucketIdRef.current ?? 'default',
          trustPins: trustPinsRef.current,
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

  // Remove messages with empty parts (e.g. interrupted assistant responses)
  // to prevent AI SDK validation errors on subsequent sends
  useEffect(() => {
    if (status === 'streaming') return
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

    if (useCloudHistory) {
      if (!isRemoteConversationFetched) return

      if (remoteConversationData?.conversation) {
        const restoredMessages =
          remoteConversationData.conversation.conversationMessages.nodes
            .filter((node): node is NonNullable<typeof node> => node !== null)
            .map((node) => node.message as UIMessage)

        setConversationId(
          conversationIdParam as ReturnType<typeof crypto.randomUUID>,
        )
        setMessages(restoredMessages)
        markMessagesAsSaved(conversationIdParam, restoredMessages)
      }
      setRestoredConversationId(conversationIdParam)
      setSearchParams({}, { replace: true })
      return
    }

    const restoreFromServer = async () => {
      try {
        const baseUrl = agentUrlRef.current
        if (!baseUrl) return
        const conversation = await fetchChatConversation(
          conversationIdParam,
          baseUrl,
        )
        setConversationId(
          conversation.id as ReturnType<typeof crypto.randomUUID>,
        )
        setMessages(conversation.messages)
      } catch (error) {
        sentry.captureException(error)
      } finally {
        setRestoredConversationId(conversationIdParam)
        setSearchParams({}, { replace: true })
      }
    }
    void restoreFromServer()
  }, [
    conversationIdParam,
    remoteConversationData,
    useCloudHistory,
    isRemoteConversationFetched,
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
      baseSendMessage({ text })
    },
    [baseSendMessage, startExecutionTask, trackMessageSent],
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
        setMode(storageAction.mode)
        sendMessage({ text: storageAction.query, action: storageAction.action })
      }
    })
    return () => unwatch()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only need to run this once
  useEffect(() => {
    const unwatch = stopAgentStorage.watch((signal) => {
      if (signal && signal.conversationId === conversationIdRef.current) {
        stop()
        track(GLOW_STOP_CLICKED_EVENT)
        stopAgentStorage.setValue(null)
      }
    })
    return () => unwatch()
  }, [])

  const resetConversationState = () => {
    stop()
    void finishExecutionTask({ isAbort: true })
    setConversationId(crypto.randomUUID())
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

      const result = await replayToolOnServer(baseUrl, {
        toolName: tool.toolName,
        args,
        conversationId: conversationIdRef.current,
        userWorkingDir: workingDirRef.current,
        workspaceId: workspaceIdRef.current,
        bucketId: bucketIdRef.current ?? 'default',
        trustPins: trustPinsRef.current,
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
      addToolApprovalResponse?.({ id: approvalId, approved: true })
    },
    [addToolApprovalResponse, setMessages],
  )

  const denyTool = useCallback(
    (approvalId: string) => {
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
    stop,
    providers,
    selectedProvider,
    isLoading: isLoadingProviders || isLoadingAgentUrl,
    canSend,
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
