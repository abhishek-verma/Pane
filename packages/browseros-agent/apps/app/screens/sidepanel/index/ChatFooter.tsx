import { X } from 'lucide-react'
import type { FC, FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { AttachmentPreviews } from '@/components/chat/composer/AttachmentPreviews'
import { ChatComposerControls } from '@/components/chat/composer/ChatComposerControls'
import { ComposerQueue } from '@/components/chat/composer/ComposerQueue'
import { ScreenshotCapture } from '@/components/chat/composer/ScreenshotCapture'
import { Button } from '@/components/ui/button'
import { LiveCaption } from '@/components/voice/LiveCaption'
import { ATTACHMENT_ACCEPT } from '@/lib/attachments'
import {
  type SelectedTextData,
  selectedTextStorage,
} from '@/lib/selected-text/selectedTextStorage'
import { cn } from '@/lib/utils'
import type { ChatMode } from '@/modules/chat/chat-types'
import { selectComposerTab } from '@/modules/chat/composer-store'
import type { ChatComposerController } from '@/modules/chat/use-chat-composer'
import type { VoiceInputState } from '@/modules/voice/voice.hooks'
import type { VoiceLoopApi } from '@/modules/voice/voice-types'
import { ChatAttachedTabs } from './ChatAttachedTabs'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ChatSelectedText } from './ChatSelectedText'
import { VoiceModeArea } from './VoiceModeArea'

export interface ChatFooterProps {
  mode: ChatMode
  composer: ChatComposerController
  onModeChange: (mode: ChatMode) => void
  input: string
  onInputChange: (value: string) => void
  onSubmit: (e: FormEvent) => void
  status: 'streaming' | 'submitted' | 'ready' | 'error'
  onStop: () => void
  sendDisabled?: boolean
  /** Detached server turn still running (show Stop even when status is ready). */
  isTurnActive?: boolean
  attachedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  onRemoveTab: (tabId?: number) => void
  voice?: VoiceInputState
  voiceLoop?: VoiceLoopApi
  onOpenVoiceMode?: () => void
}

export const ChatFooter: FC<ChatFooterProps> = ({
  mode,
  composer,
  onModeChange,
  input,
  onInputChange,
  onSubmit,
  status,
  onStop,
  sendDisabled,
  isTurnActive,
  attachedTabs,
  onToggleTab,
  onRemoveTab,
  voice,
  voiceLoop,
  onOpenVoiceMode,
}) => {
  const fileInput = useRef<HTMLInputElement>(null)
  const [capture, setCapture] = useState(false)
  const [dragging, setDragging] = useState(false)
  const chatInputRef = useRef<ChatInputHandle>(null)
  const [selectionMap, setSelectionMap] = useState<
    Record<string, SelectedTextData>
  >({})
  const [activeTabId, setActiveTabId] = useState<number | undefined>()

  // Track active tab for tab-scoped selection display
  useEffect(() => {
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => setActiveTabId(tabs[0]?.id))
    const listener = (activeInfo: { tabId: number }) => {
      setActiveTabId(activeInfo.tabId)
    }
    chrome.tabs.onActivated.addListener(listener)
    return () => chrome.tabs.onActivated.removeListener(listener)
  }, [])

  // Watch selected text storage (per-tab map)
  useEffect(() => {
    selectedTextStorage.getValue().then(setSelectionMap)
    const unwatch = selectedTextStorage.watch(setSelectionMap)
    return () => unwatch()
  }, [])

  const visibleSelectedText = activeTabId
    ? (selectionMap[String(activeTabId)] ?? null)
    : null

  useEffect(() => {
    const focusInput = () => {
      const active = document.activeElement
      const isInteractiveElementFocused =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        active instanceof HTMLButtonElement
      if (!isInteractiveElementFocused) {
        chatInputRef.current?.focus()
      }
    }

    if (document.hasFocus()) {
      focusInput()
    }

    window.addEventListener('focus', focusInput)
    return () => window.removeEventListener('focus', focusInput)
  }, [])

  return (
    <footer className="shrink-0 px-3 pt-3 pb-3">
      <ComposerQueue composer={composer} />
      <section
        aria-label="Message composer"
        className={cn(
          'relative rounded-3xl border border-border/60 bg-background p-2.5 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.08)] transition-colors focus-within:border-foreground/25',
          dragging && 'border-foreground bg-muted/50',
        )}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node))
            setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          composer.addFiles(Array.from(event.dataTransfer.files))
        }}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/95 text-sm">
            Drop files or photos here
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          aria-label="Add files or photos"
          onChange={(event) => {
            composer.addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <AttachmentPreviews
          attachments={composer.state.draft.attachments}
          onRemove={(id) =>
            composer.setDraft((draft) => ({
              ...draft,
              attachments: draft.attachments.filter((item) => item.id !== id),
            }))
          }
        />
        <ChatAttachedTabs
          tabs={attachedTabs.filter(
            (tab) => !input.includes(`](tab:${tab.id})`),
          )}
          onRemoveTab={onRemoveTab}
        />
        {visibleSelectedText && (
          <ChatSelectedText
            selectedText={visibleSelectedText}
            onDismiss={() => {
              if (!activeTabId) return
              const key = String(activeTabId)
              selectedTextStorage.getValue().then((map) => {
                const { [key]: _, ...rest } = map
                selectedTextStorage.setValue(rest)
              })
            }}
          />
        )}

        <div>
          <VoiceModeArea voiceLoop={voiceLoop}>
            <ChatInput
              key={composer.draftKey}
              input={input}
              hasAttachments={composer.state.draft.attachments.length > 0}
              onFiles={composer.addFiles}
              preparing={composer.preparing}
              controls={
                <ChatComposerControls
                  selectedTabs={attachedTabs}
                  onToggleTab={onToggleTab}
                  onFiles={() => fileInput.current?.click()}
                  onScreenshot={() => setCapture(true)}
                  mode={mode}
                  onModeChange={onModeChange}
                />
              }
              status={status}
              mode={mode}
              sendDisabled={sendDisabled}
              isTurnActive={isTurnActive}
              onInputChange={onInputChange}
              onSubmit={onSubmit}
              onStop={onStop}
              selectedTabs={attachedTabs}
              onSelectTab={(tab) =>
                composer.setDraft((draft) => ({
                  ...draft,
                  tabs: selectComposerTab(draft.tabs, tab),
                }))
              }
              voice={voice}
              onOpenVoiceMode={onOpenVoiceMode}
              ref={chatInputRef}
            />
          </VoiceModeArea>

          {voice?.error && (
            <div className="mt-1 flex items-center gap-1.5 text-destructive text-xs">
              <span>{voice.error}</span>
              {voice.canRetry && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-destructive text-xs underline"
                  onClick={voice.retryTranscription}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
          {(voice?.isRecording || voice?.isTranscribing) &&
            voice.partialTranscript && (
              <LiveCaption text={voice.partialTranscript} className="mt-1" />
            )}
        </div>
      </section>
      {composer.error && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 text-destructive text-xs"
        >
          <p className="flex-1 whitespace-pre-wrap">{composer.error}</p>
          <button
            type="button"
            onClick={composer.dismissError}
            aria-label="Dismiss attachment error"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
      {capture && (
        <ScreenshotCapture
          onAttach={composer.addFiles}
          onClose={() => setCapture(false)}
        />
      )}
    </footer>
  )
}
