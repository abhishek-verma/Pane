import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { LiveWatchStrip } from '@/components/tool-evidence/LiveWatchStrip'
import { createBrowserOSAction } from '@/lib/chat-actions/types'
import {
  SIDEPANEL_AI_TRIGGERED_EVENT,
  SIDEPANEL_MODE_CHANGED_EVENT,
  SIDEPANEL_STOP_CLICKED_EVENT,
  SIDEPANEL_SUGGESTION_CLICKED_EVENT,
  SIDEPANEL_TAB_REMOVED_EVENT,
  SIDEPANEL_TAB_TOGGLED_EVENT,
  SIDEPANEL_VOICE_ERROR_EVENT,
  SIDEPANEL_VOICE_RECORDING_STARTED_EVENT,
  SIDEPANEL_VOICE_RECORDING_STOPPED_EVENT,
  SIDEPANEL_VOICE_TRANSCRIPTION_COMPLETED_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import { isAttachableTabUrl } from '@/lib/personal-internet/attachable-tab-url'
import {
  resolveWatchPageId,
  shouldEnableLiveWatch,
} from '@/lib/tool-evidence/resolve-watch-target'
import { isBenignClientRenderError } from '@/modules/chat/benign-client-render-error'
import { useChatSessionContext } from '@/modules/chat/chat-session-context'
import type { ChatMode } from '@/modules/chat/chat-types'
import { useConversationBackgroundMeta } from '@/modules/chat/use-conversation-background-meta'
import { useConversationPendingApprovals } from '@/modules/chat/use-conversation-pending-approvals'
import { useVoiceInput } from '@/modules/voice/voice.hooks'
import {
  type ChatSessionLike,
  useVoiceLoop,
} from '@/modules/voice/voice-loop.hooks'
import { BackgroundAgentBanner } from './BackgroundAgentBanner'
import { ChannelApprovalCard } from './ChannelApprovalCard'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatError } from './ChatError'
import { ChatFooter } from './ChatFooter'
import { ChatMessages } from './ChatMessages'

/**
 * @public
 */
export const Chat = () => {
  const {
    mode,
    setMode,
    messages,
    sendMessage,
    status,
    stop,
    agentUrlError,
    chatError,
    canSend,
    selectedProvider,
    getActionForMessage,
    liked,
    onClickLike,
    disliked,
    onClickDislike,
    isRestoringConversation,
    approveTool,
    denyTool,
    promoteTool,
    retryLastTurn,
    isStreaming: sessionStreaming,
    isTurnActive,
    hasMoreAbove,
    loadOlderMessages,
    conversationId,
  } = useChatSessionContext()

  const channelApprovals = useConversationPendingApprovals(conversationId)
  const { isBackground, backgroundSource } =
    useConversationBackgroundMeta(conversationId)

  const voice = useVoiceInput()
  const chatSessionRef = useRef<ChatSessionLike | null>(null)
  chatSessionRef.current = { sendMessage, stop, status, messages }
  const voiceLoop = useVoiceLoop({ chatSessionRef })

  const [input, setInput] = useState('')
  const [attachedTabs, setAttachedTabs] = useState<chrome.tabs.Tab[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    ;(async () => {
      const currentTab = (
        await chrome.tabs.query({
          active: true,
          currentWindow: true,
        })
      ).filter((tab) => isAttachableTabUrl(tab.url))
      setAttachedTabs(currentTab)
    })()
  }, [])

  // Insert transcript into input when transcription completes
  // biome-ignore lint/correctness/useExhaustiveDependencies: only trigger on transcript/transcribing change
  useEffect(() => {
    if (voice.transcript && !voice.isTranscribing) {
      setInput((prev) => {
        const separator = prev.trim() ? ' ' : ''
        return prev + separator + voice.transcript
      })
      track(SIDEPANEL_VOICE_TRANSCRIPTION_COMPLETED_EVENT)
      voice.clearTranscript()
    }
  }, [voice.transcript, voice.isTranscribing])

  // Track voice errors
  useEffect(() => {
    if (voice.error) {
      track(SIDEPANEL_VOICE_ERROR_EVENT, { error: voice.error })
    }
  }, [voice.error])

  const handleModeChange = (newMode: ChatMode) => {
    track(SIDEPANEL_MODE_CHANGED_EVENT, { from: mode, to: newMode })
    setMode(newMode)
  }

  const handleStop = () => {
    track(SIDEPANEL_STOP_CLICKED_EVENT)
    stop()
  }

  const toggleTabSelection = (tab: chrome.tabs.Tab) => {
    setAttachedTabs((prev) => {
      const isSelected = prev.some((t) => t.id === tab.id)
      track(SIDEPANEL_TAB_TOGGLED_EVENT, {
        action: isSelected ? 'removed' : 'added',
      })
      if (isSelected) {
        return prev.filter((t) => t.id !== tab.id)
      }
      return [...prev, tab]
    })
  }

  const removeTab = (tabId?: number) => {
    track(SIDEPANEL_TAB_REMOVED_EVENT)
    setAttachedTabs((prev) => prev.filter((t) => t.id !== tabId))
  }

  const executeMessage = (customMessageText?: string) => {
    const messageText = customMessageText ? customMessageText : input.trim()
    if (!messageText) return

    if (attachedTabs.length) {
      const action = createBrowserOSAction({
        mode,
        message: messageText,
        tabs: attachedTabs,
      })
      sendMessage({ text: messageText, action })
    } else {
      sendMessage({ text: messageText })
    }
    setInput('')
    setAttachedTabs([])
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (messages.length === 0) {
      track(SIDEPANEL_AI_TRIGGERED_EVENT, {
        mode,
        tabs_count: attachedTabs.length,
      })
    }
    executeMessage()
  }

  const handleSuggestionClick = (suggestion: string) => {
    track(SIDEPANEL_SUGGESTION_CLICKED_EVENT, { mode })
    executeMessage(suggestion)
  }

  const handleStartRecording = async () => {
    const started = await voice.startRecording()
    if (started) {
      track(SIDEPANEL_VOICE_RECORDING_STARTED_EVENT)
    }
  }

  const handleStopRecording = async () => {
    await voice.stopRecording()
    track(SIDEPANEL_VOICE_RECORDING_STOPPED_EVENT)
  }

  const voiceState = {
    isRecording: voice.isRecording,
    isTranscribing: voice.isTranscribing,
    audioLevels: voice.audioLevels,
    error: voice.error,
    partialTranscript: voice.partialTranscript,
    canRetry: voice.canRetry,
    onStartRecording: handleStartRecording,
    onStopRecording: handleStopRecording,
    retryTranscription: voice.retryTranscription,
  }

  const isStreaming =
    sessionStreaming || status === 'streaming' || status === 'submitted'
  const showLiveWatch =
    mode === 'agent' && shouldEnableLiveWatch(messages, isStreaming)
  const watchPageId = showLiveWatch ? resolveWatchPageId(messages) : undefined

  return (
    <>
      <main className="mt-4 flex h-full min-h-0 flex-1 flex-col space-y-4 overflow-hidden">
        {isRestoringConversation ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 && channelApprovals.approvals.length === 0 ? (
          <ChatEmptyState
            mode={mode}
            mounted={mounted}
            onSuggestionClick={handleSuggestionClick}
          />
        ) : (
          <>
            {isBackground ? (
              <BackgroundAgentBanner source={backgroundSource} />
            ) : null}
            {messages.length > 0 ? (
              <ChatMessages
                messages={messages}
                status={status}
                getActionForMessage={getActionForMessage}
                liked={liked}
                onClickLike={onClickLike}
                disliked={disliked}
                onClickDislike={onClickDislike}
                onApprove={approveTool}
                onDeny={denyTool}
                onPromote={promoteTool}
                hasMoreAbove={hasMoreAbove}
                onLoadOlder={loadOlderMessages}
              />
            ) : null}
          </>
        )}
        {channelApprovals.approvals.map((approval) => (
          <ChannelApprovalCard
            key={approval.id}
            approval={approval}
            busy={channelApprovals.resolvingId === approval.id}
            note={
              channelApprovals.resolvingId === approval.id ||
              channelApprovals.approvals.length === 1
                ? channelApprovals.note
                : null
            }
            onApprove={() => {
              void channelApprovals.resolve(approval, 'approve')
            }}
            onAllowForChat={() => {
              void channelApprovals.resolve(approval, 'allowForChat')
            }}
            onDeny={() => {
              void channelApprovals.resolve(approval, 'deny')
            }}
          />
        ))}
        {agentUrlError && (
          <ChatError
            error={agentUrlError}
            providerType={selectedProvider?.type}
          />
        )}
        {chatError && !isBenignClientRenderError(chatError) && (
          <ChatError
            error={chatError}
            providerType={selectedProvider?.type}
            onRetry={retryLastTurn}
          />
        )}
      </main>

      <LiveWatchStrip pageId={watchPageId} enabled={showLiveWatch} />

      <ChatFooter
        mode={mode}
        onModeChange={handleModeChange}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        status={status}
        onStop={handleStop}
        sendDisabled={!canSend}
        isTurnActive={isTurnActive}
        attachedTabs={attachedTabs}
        onToggleTab={toggleTabSelection}
        onRemoveTab={removeTab}
        voice={voiceState}
        voiceLoop={voiceLoop}
        onOpenVoiceMode={voiceLoop.open}
      />
    </>
  )
}
