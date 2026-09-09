import {
  Camera,
  FilePlus2,
  Folder,
  Layers,
  PlugZap,
  Plus,
  SlidersHorizontal,
} from 'lucide-react'
import {
  type FC,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react'
import { ChatProviderSelector } from '@/components/chat/ChatProviderSelector'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { AttachmentPreviews } from '@/components/chat/composer/AttachmentPreviews'
import { ScreenshotCapture } from '@/components/chat/composer/ScreenshotCapture'
import { TabPickerPopover } from '@/components/elements/tab-picker-popover'
import { WorkspaceSelector } from '@/components/elements/workspace-selector'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  ATTACHMENT_ACCEPT,
  type StagedAttachment,
  stageAttachments,
} from '@/lib/attachments'
import {
  type ChatDraft,
  emptyDraft,
  removeAcceptedDraft,
} from '@/modules/chat/composer-store'
import { useVoiceInput } from '@/modules/voice/voice.hooks'
import { ChatAttachedTabs } from '@/screens/sidepanel/index/ChatAttachedTabs'
import {
  ChatInput,
  type ChatInputHandle,
} from '@/screens/sidepanel/index/ChatInput'
export interface ConversationInputSendInput {
  text: string
  attachments: StagedAttachment[]
  selectedTabs: chrome.tabs.Tab[]
}

export interface ConversationInputProps {
  draft?: { text: string; id: number }
  onSend: (
    input: ConversationInputSendInput,
  ) => void | boolean | Promise<void> | Promise<boolean | undefined>
  /**
   * Merged provider/agent picker shown only on the `home` variant. Lets the
   * composer target either an LLM provider (BrowserOS, etc.) or a named agent.
   */
  providers?: Provider[]
  selectedProvider?: Provider | null
  onSelectProvider?: (provider: Provider) => void
  streaming: boolean
  disabled?: boolean
  status?: string
  placeholder?: string
  attachmentsEnabled?: boolean
  variant?: 'home' | 'conversation'
  /**
   * When set, a Stop button surfaces to the left of the voice mic
   * while `streaming === true`. Click cancels the active turn
   * server-side via the chat-cancel endpoint. Absent → no Stop
   * button (legacy behaviour for the home composer).
   */
  onStop?: () => void
  /**
   * When set, a voice-mode entry button surfaces next to the dictation
   * mic. Home uses this to hand off to the chat surface where the full
   * voice-loop overlay lives. Absent → button hidden.
   */
  onOpenVoiceMode?: () => void
}

export const ConversationInput: FC<ConversationInputProps> = ({
  draft,
  onSend,
  providers,
  selectedProvider,
  onSelectProvider,
  streaming,
  disabled,
  attachmentsEnabled = true,
  variant = 'conversation',
  onStop,
  onOpenVoiceMode,
}) => {
  const [content, setContent] = useState<ChatDraft>(emptyDraft)
  const { text: input, tabs, attachments } = content
  function setInput(value: SetStateAction<string>) {
    setContent((current) => ({
      ...current,
      text: typeof value === 'function' ? value(current.text) : value,
    }))
  }
  function setTabs(value: SetStateAction<chrome.tabs.Tab[]>) {
    setContent((current) => ({
      ...current,
      tabs: typeof value === 'function' ? value(current.tabs) : value,
    }))
  }
  function setAttachments(value: SetStateAction<StagedAttachment[]>) {
    setContent((current) => ({
      ...current,
      attachments:
        typeof value === 'function' ? value(current.attachments) : value,
    }))
  }
  const [error, setError] = useState<string>()
  const [preparing, setPreparing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [capture, setCapture] = useState(false)
  const [menu, setMenu] = useState(false)
  const [dragging, setDragging] = useState(false)
  const files = useRef<HTMLInputElement>(null)
  const editor = useRef<ChatInputHandle>(null)
  const attachmentRef = useRef(attachments)
  attachmentRef.current = attachments
  const stagingCount = useRef(0)
  const staging = useRef(Promise.resolve())
  const voice = useVoiceInput()
  useEffect(() => {
    if (draft) {
      setContent((current) => ({ ...current, text: draft.text }))
      editor.current?.focus()
    }
  }, [draft])
  useEffect(() => {
    if (voice.transcript && !voice.isTranscribing) {
      setContent((current) => ({
        ...current,
        text: [current.text, voice.transcript].filter(Boolean).join(' '),
      }))
      voice.clearTranscript()
    }
  }, [voice.transcript, voice.isTranscribing, voice.clearTranscript])
  function addFiles(incoming: File[]) {
    if (!attachmentsEnabled) {
      setError('This assistant does not support attachments.')
      return
    }
    stagingCount.current += 1
    setPreparing(true)
    staging.current = staging.current
      .then(async () => {
        const result = await stageAttachments(
          incoming,
          attachmentRef.current.length,
        )
        const next = [...attachmentRef.current, ...result.staged].slice(0, 10)
        attachmentRef.current = next
        setAttachments(next)
        setError(
          result.errors.map((error) => error.message).join('\n') || undefined,
        )
      })
      .catch((error) =>
        setError(
          error instanceof Error
            ? error.message
            : 'Could not read the attachment.',
        ),
      )
      .finally(() => {
        stagingCount.current -= 1
        setPreparing(stagingCount.current > 0)
      })
  }
  const toggleTab = (tab: chrome.tabs.Tab) =>
    setTabs((value) =>
      value.some((item) => item.id === tab.id)
        ? value.filter((item) => item.id !== tab.id)
        : [...value, tab],
    )
  async function submit() {
    if (
      disabled ||
      submitting ||
      preparing ||
      (!input.trim() && !attachments.length)
    )
      return
    setSubmitting(true)
    setError(undefined)
    try {
      const accepted = await onSend({
        text: input.trim(),
        attachments,
        selectedTabs: tabs,
      })
      if (accepted === false) {
        setError('Your message was not accepted. Your draft is still here.')
        return
      }
      setContent((current) => removeAcceptedDraft(current, content))
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not send. Your draft is still here.',
      )
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <section
      aria-label="Message composer"
      className={`relative rounded-2xl border border-border/70 bg-background p-3 shadow-sm focus-within:border-foreground/25 ${dragging ? 'ring-1 ring-foreground/30' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        addFiles(Array.from(event.dataTransfer.files))
      }}
    >
      <input
        ref={files}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        aria-label="Add files or photos"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <AttachmentPreviews
        attachments={attachments}
        onRemove={(id) =>
          setAttachments((value) => value.filter((item) => item.id !== id))
        }
      />
      <ChatAttachedTabs
        tabs={tabs.filter((tab) => !input.includes(`](tab:${tab.id})`))}
        onRemoveTab={(id) => {
          setTabs((value) => value.filter((tab) => tab.id !== id))
          setInput((value) =>
            value.replace(/@\[[^\]]+\]\(tab:(\d+)\)/g, (token, tabId) =>
              Number(tabId) === id ? '' : token,
            ),
          )
        }}
      />
      <ChatInput
        ref={editor}
        input={input}
        onInputChange={setInput}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
        onStop={onStop ?? (() => {})}
        isTurnActive={streaming}
        status={streaming ? 'streaming' : 'ready'}
        mode="agent"
        sendDisabled={disabled || submitting || (streaming && !onStop)}
        selectedTabs={tabs}
        onToggleTab={toggleTab}
        hasAttachments={attachments.length > 0}
        onFiles={addFiles}
        preparing={preparing}
        onOpenVoiceMode={onOpenVoiceMode}
        voice={{
          isRecording: voice.isRecording,
          isTranscribing: voice.isTranscribing,
          audioLevels: voice.audioLevels,
          error: voice.error,
          canRetry: voice.canRetry,
          partialTranscript: voice.partialTranscript,
          onStartRecording: voice.startRecording,
          onStopRecording: voice.stopRecording,
          retryTranscription: voice.retryTranscription,
        }}
        controls={
          <>
            <Popover open={menu} onOpenChange={setMenu}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Add context"
                  className="rounded-full p-2 text-muted-foreground hover:bg-muted"
                >
                  <Plus className="size-5" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-64 p-1.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
                  onClick={() => {
                    setMenu(false)
                    files.current?.click()
                  }}
                >
                  <FilePlus2 className="size-4" />
                  Add files or photos
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
                  onClick={() => {
                    setMenu(false)
                    setCapture(true)
                  }}
                >
                  <Camera className="size-4" />
                  Take screenshot
                </button>
                <TabPickerPopover
                  variant="selector"
                  selectedTabs={tabs}
                  onToggleTab={toggleTab}
                  side="right"
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
                  >
                    <Layers className="size-4" />
                    Add tabs
                  </button>
                </TabPickerPopover>
                <div className="my-1 border-t" />
                <WorkspaceSelector side="right">
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
                  >
                    <Folder className="size-4" />
                    Workspace folder
                  </button>
                </WorkspaceSelector>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
                  onClick={() =>
                    window.open(
                      chrome.runtime.getURL('/app.html#/settings/mcp'),
                      '_blank',
                    )
                  }
                >
                  <PlugZap className="size-4" />
                  Connect apps
                </button>
              </PopoverContent>
            </Popover>
            {variant === 'home' &&
              selectedProvider &&
              providers &&
              onSelectProvider && (
                <ChatProviderSelector
                  providers={providers}
                  selectedProvider={selectedProvider}
                  onSelectProvider={onSelectProvider}
                >
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-muted-foreground text-xs hover:bg-muted"
                  >
                    <SlidersHorizontal className="size-3.5" />
                    <span className="max-w-32 truncate">
                      {selectedProvider.name}
                    </span>
                  </button>
                </ChatProviderSelector>
              )}
          </>
        }
      />
      {(error || voice.error) && (
        <p
          role="alert"
          className="mt-2 whitespace-pre-wrap text-destructive text-xs"
        >
          {error || voice.error}
        </p>
      )}
      {capture && (
        <ScreenshotCapture
          onAttach={addFiles}
          onClose={() => setCapture(false)}
        />
      )}
    </section>
  )
}
