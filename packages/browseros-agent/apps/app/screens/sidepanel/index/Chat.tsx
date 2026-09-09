import { Loader2 } from 'lucide-react'
import { LiveWatchStrip } from '@/components/tool-evidence/LiveWatchStrip'
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
import {
  resolveWatchPageId,
  shouldEnableLiveWatch,
} from '@/lib/tool-evidence/resolve-watch-target'
import { isBenignClientRenderError } from '@/modules/chat/benign-client-render-error'
import { useConversationBackgroundMeta } from '@/modules/chat/use-conversation-background-meta'
import { useConversationPendingApprovals } from '@/modules/chat/use-conversation-pending-approvals'
import { useChatActions } from '@/modules/chat-actions/chat-actions.hooks'
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
    messages,
    status,
    agentUrlError,
    chatError,
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
    composer,
    input,
    setInput,
    attachedTabs,
    mounted,
    voiceState,
    voiceLoop,
    handleModeChange,
    handleStop,
    toggleTabSelection,
    removeTab,
    handleSubmit,
    handleSuggestionClick,
  } = useChatActions({
    autoAttachActiveTab: true,
    events: {
      modeChanged: SIDEPANEL_MODE_CHANGED_EVENT,
      stopClicked: SIDEPANEL_STOP_CLICKED_EVENT,
      suggestionClicked: SIDEPANEL_SUGGESTION_CLICKED_EVENT,
      tabToggled: SIDEPANEL_TAB_TOGGLED_EVENT,
      tabRemoved: SIDEPANEL_TAB_REMOVED_EVENT,
      aiTriggered: SIDEPANEL_AI_TRIGGERED_EVENT,
      voiceRecordingStarted: SIDEPANEL_VOICE_RECORDING_STARTED_EVENT,
      voiceRecordingStopped: SIDEPANEL_VOICE_RECORDING_STOPPED_EVENT,
      voiceTranscriptionCompleted:
        SIDEPANEL_VOICE_TRANSCRIPTION_COMPLETED_EVENT,
      voiceError: SIDEPANEL_VOICE_ERROR_EVENT,
    },
  })
  const channelApprovals = useConversationPendingApprovals(conversationId)
  const { isBackground, backgroundSource } =
    useConversationBackgroundMeta(conversationId)

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
            onAllowAlways={() => {
              void channelApprovals.resolve(approval, 'allowAlways')
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
        composer={composer}
        mode={mode}
        onModeChange={handleModeChange}
        input={input}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        status={status}
        onStop={handleStop}
        sendDisabled={!composer.ready || isRestoringConversation}
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
