import {
  ArrowRight,
  AudioLines,
  Bot,
  ChevronDown,
  FileText,
  Folder,
  Layers,
  Loader2,
  Mic,
  Paperclip,
  PlugZap,
  Square,
  X,
} from 'lucide-react'
import {
  type DragEvent,
  type FC,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { PaneWordmark } from '@/components/branding/PaneWordmark'
import { ChatProviderSelector } from '@/components/chat/ChatProviderSelector'
import type { Provider } from '@/components/chat/chatComponentTypes'
import { TabPickerPopover } from '@/components/elements/tab-picker-popover'
import { WorkspaceSelector } from '@/components/elements/workspace-selector'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { type StagedAttachment, stageAttachments } from '@/lib/attachments'
import { PaneIcon, ProviderIcon } from '@/lib/llm-providers/providerIcons'
import type { ProviderType } from '@/lib/llm-providers/types'
import { cn } from '@/lib/utils'
import { VOICE_SUPPORTED } from '@/lib/voice/voice-supported'
import { useVoiceInput } from '@/modules/voice/voice.hooks'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'

export interface ConversationInputSendInput {
  text: string
  attachments: StagedAttachment[]
  selectedTabs: chrome.tabs.Tab[]
}

export interface ConversationInputProps {
  onSend: (input: ConversationInputSendInput) => void
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

function InputActionButton({
  disabled,
  onClick,
  streaming,
  hasContent,
}: {
  disabled: boolean
  onClick: () => void
  streaming: boolean
  hasContent: boolean
}) {
  // Show the spinner while streaming only when there's nothing to
  // send — once the user types something, the icon flips back to the
  // paper-plane so it reads as "queue this message" instead of
  // "still working".
  const showSpinner = streaming && !hasContent
  return (
    <Button
      onClick={onClick}
      size="icon"
      disabled={disabled}
      title={streaming && hasContent ? 'Queue message' : undefined}
      className="h-10 w-10 flex-shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
    >
      {showSpinner ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <ArrowRight className="h-5 w-5" />
      )}
    </Button>
  )
}

function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onStop}
      title="Stop current turn — queued messages will start next."
      aria-label="Stop current turn"
      className="h-8 w-8 flex-shrink-0 rounded-md bg-destructive/10 text-destructive transition-colors hover:bg-destructive/15 hover:text-destructive"
    >
      <Square className="h-3.5 w-3.5 fill-current" />
    </Button>
  )
}

function VoiceModeEntryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      className="h-10 w-10 flex-shrink-0 rounded-md text-muted-foreground transition-colors hover:text-foreground"
      title="Open voice mode"
      aria-label="Open voice mode"
    >
      <AudioLines className="h-5 w-5" />
    </Button>
  )
}

function VoiceButton({
  isRecording,
  isTranscribing,
  onStart,
  onStop,
}: {
  isRecording: boolean
  isTranscribing: boolean
  onStart: () => void
  onStop: () => void
}) {
  if (isRecording) {
    return (
      <Button
        type="button"
        size="icon"
        onClick={onStop}
        className="h-10 w-10 flex-shrink-0 rounded-full bg-red-600 text-white hover:bg-red-700"
      >
        <Square className="h-4 w-4" />
      </Button>
    )
  }

  if (isTranscribing) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled
        className="h-10 w-10 flex-shrink-0 rounded-md"
      >
        <Loader2 className="h-5 w-5 animate-spin" />
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onStart}
      className="h-10 w-10 flex-shrink-0 rounded-md text-muted-foreground transition-colors hover:text-foreground"
      title="Voice input"
    >
      <Mic className="h-5 w-5" />
    </Button>
  )
}

/**
 * Calm-composer footer shared by both `/home` (`variant="home"`) and
 * the chat surface at `/home/agents/:agentId` (`variant="conversation"`).
 * Pill-shaped chips on an internal dashed divider, with a right-aligned
 * keyboard hint. The merged provider/agent picker is conditional via
 * `showAgentSelector`: home shows it as a filled pill on the left; the
 * chat surface hides it (the target is locked once you're in the
 * conversation).
 */
function CalmContextControls({
  providers,
  selectedProvider,
  onSelectProvider,
  selectedTabs,
  onToggleTab,
  showAgentSelector,
  onAttachClick,
  attachDisabled,
  attachmentsEnabled,
}: {
  providers?: Provider[]
  selectedProvider?: Provider | null
  onSelectProvider?: (provider: Provider) => void
  selectedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  showAgentSelector: boolean
  onAttachClick: () => void
  attachDisabled: boolean
  attachmentsEnabled: boolean
}) {
  const { selectedFolder } = useWorkspace()

  return (
    <div className="mx-3 flex items-center gap-0.5 pt-0.5 pb-1.5">
      {showAgentSelector &&
      providers &&
      selectedProvider &&
      onSelectProvider ? (
        <>
          <ChatProviderSelector
            providers={providers}
            selectedProvider={selectedProvider}
            onSelectProvider={onSelectProvider}
          >
            <button
              type="button"
              className={cn(
                'inline-flex h-6 max-w-[200px] items-center gap-1.5 rounded-md border border-border/60 bg-accent/30 pr-2 pl-2.5 text-[11.5px] text-foreground transition-colors',
                'hover:border-border hover:bg-accent/70 data-[state=open]:border-border data-[state=open]:bg-accent/70',
              )}
            >
              {selectedProvider.type === 'browseros' ? (
                <PaneWordmark size="xs" />
              ) : (
                <>
                  <TargetPillIcon provider={selectedProvider} />
                  <span className="truncate font-medium font-mono text-[11.5px] tracking-[-0.01em]">
                    {selectedProvider.name}
                  </span>
                </>
              )}
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </ChatProviderSelector>
          <span
            aria-hidden="true"
            className="mx-1 inline-block h-3.5 w-px shrink-0 bg-border"
          />
        </>
      ) : null}
      <WorkspaceSelector>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Folder className="size-3" />
          <span>Workspace</span>
          <span className="font-mono text-[10.5px] text-muted-foreground/70">
            {selectedFolder?.name ?? 'none'}
          </span>
        </button>
      </WorkspaceSelector>
      <TabPickerPopover
        variant="selector"
        selectedTabs={selectedTabs}
        onToggleTab={onToggleTab}
      >
        <button
          type="button"
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors data-[state=open]:bg-accent data-[state=open]:text-foreground',
            selectedTabs.length > 0
              ? 'bg-[var(--accent-orange)] text-primary-foreground hover:bg-[var(--accent-orange)]/90'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Layers className="size-3" />
          <span>Tabs</span>
          <span
            className={cn(
              'font-mono text-[10.5px]',
              selectedTabs.length > 0
                ? 'text-primary-foreground/80'
                : 'text-muted-foreground/70',
            )}
          >
            {selectedTabs.length}
          </span>
        </button>
      </TabPickerPopover>
      <span
        aria-hidden="true"
        className="mx-1 inline-block h-3.5 w-px shrink-0 bg-border"
      />
      <button
        type="button"
        onClick={onAttachClick}
        disabled={attachDisabled || !attachmentsEnabled}
        title="Attach files"
        className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip className="size-3" />
        <span>Attach</span>
      </button>
      <button
        type="button"
        onClick={() =>
          window.open(
            chrome.runtime.getURL('/app.html#/settings/mcp'),
            '_blank',
          )
        }
        className="inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <PlugZap className="size-3" />
        <span>Apps</span>
      </button>
    </div>
  )
}

function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div className="agent-composer-field overflow-hidden transition-[border-color] duration-150 focus-within:border-[var(--accent-orange)]">
      {children}
    </div>
  )
}

function ConversationShell({ children }: { children: ReactNode }) {
  return (
    <div className="agent-composer-field overflow-hidden bg-background/95 transition-[border-color] duration-150 focus-within:border-[var(--accent-orange)]">
      {children}
    </div>
  )
}

export const ConversationInput: FC<ConversationInputProps> = ({
  onSend,
  providers,
  selectedProvider,
  onSelectProvider,
  streaming,
  disabled,
  placeholder,
  attachmentsEnabled = true,
  variant = 'conversation',
  onStop,
  onOpenVoiceMode,
}) => {
  const [input, setInput] = useState('')
  const [selectedTabs, setSelectedTabs] = useState<chrome.tabs.Tab[]>([])
  const [isExpandedDraft, setIsExpandedDraft] = useState(false)
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isStaging, setIsStaging] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const voice = useVoiceInput()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isConversation = variant === 'conversation'

  const stageFiles = async (files: File[]) => {
    if (files.length === 0) return
    if (!attachmentsEnabled) {
      setAttachmentError('Attachments are not supported for this agent yet.')
      return
    }
    setIsStaging(true)
    setAttachmentError(null)
    try {
      const result = await stageAttachments(files, attachments.length)
      if (result.staged.length > 0) {
        setAttachments((prev) => [...prev, ...result.staged])
      }
      if (result.errors.length > 0) {
        setAttachmentError(result.errors.map((e) => e.message).join(' \u2022 '))
      }
    } finally {
      setIsStaging(false)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
    setAttachmentError(null)
  }

  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return

    const maxHeight = isConversation ? 176 : 100
    const collapsedHeight = isConversation ? 56 : 72
    element.style.height = '0px'
    const nextHeight = Math.min(element.scrollHeight, maxHeight)
    element.style.height = `${nextHeight}px`
    element.style.overflowY =
      element.scrollHeight > maxHeight ? 'auto' : 'hidden'
    setIsExpandedDraft(nextHeight > collapsedHeight)
  })

  useEffect(() => {
    if (voice.transcript && !voice.isTranscribing) {
      setInput(voice.transcript)
      voice.clearTranscript()
    }
  }, [voice.transcript, voice.isTranscribing, voice])

  useEffect(() => {
    if (attachmentsEnabled) return
    setAttachments([])
    setAttachmentError(null)
  }, [attachmentsEnabled])

  const toggleTab = (tab: chrome.tabs.Tab) => {
    setSelectedTabs((prev) => {
      const isSelected = prev.some((selected) => selected.id === tab.id)
      if (isSelected) {
        return prev.filter((selected) => selected.id !== tab.id)
      }
      return [...prev, tab]
    })
  }

  const hasContent = input.trim().length > 0 || attachments.length > 0
  // Queue-aware composers (the conversation panel passes `onStop`)
  // accept input while streaming — the parent decides whether the
  // submission opens a new turn or enqueues onto the active one.
  // Surfaces without a Stop hook (home) keep the legacy behaviour
  // and block input until the current turn finishes.
  const queueAware = Boolean(onStop)

  const handleSend = () => {
    const text = input.trim()
    if (disabled || isStaging) return
    if (streaming && !queueAware) return
    if (!text && attachments.length === 0) return
    onSend({ text, attachments, selectedTabs })
    setInput('')
    setAttachments([])
    setSelectedTabs([])
    setAttachmentError(null)
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      void stageFiles(files)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragOver(false)
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length > 0) {
      void stageFiles(files)
    }
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }
    setIsDragOver(false)
  }

  const openFilePicker = () => {
    if (!attachmentsEnabled) {
      setAttachmentError('Attachments are not supported for this agent yet.')
      return
    }
    fileInputRef.current?.click()
  }

  const handleFileInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length > 0) void stageFiles(files)
  }

  const shell = variant === 'home' ? HomeShell : ConversationShell
  const Shell = shell

  return (
    <Shell>
      <section
        // Drag/drop on a region isn't a click affordance — wrap the
        // composer in a labeled <section> so the a11y rule is satisfied
        // without misrepresenting the surface as interactive.
        aria-label="Message composer"
        className={cn('relative', isDragOver && 'ring-2 ring-primary/60')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,text/*,application/json"
          className="hidden"
          onChange={handleFileInputChange}
        />
        {attachments.length > 0 || attachmentError ? (
          <AttachmentStrip
            attachments={attachments}
            onRemove={removeAttachment}
            error={attachmentError}
          />
        ) : null}
        <div
          className={cn(
            'flex gap-2.5 px-3 pt-2 pb-1',
            isExpandedDraft ? 'items-end' : 'items-center',
          )}
        >
          <BotInputIcon />
          <div className="flex-1">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  handleSend()
                }
              }}
              onPaste={handlePaste}
              rows={1}
              placeholder={
                voice.isTranscribing
                  ? 'Transcribing...'
                  : (placeholder ??
                    `Message ${selectedProvider?.name ?? 'agent'}...`)
              }
              disabled={disabled || voice.isTranscribing}
              className={cn(
                'resize-none border-none bg-transparent px-0 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent',
                '[field-sizing:fixed]',
                'min-h-[32px] py-1.5 leading-[1.45]',
                'placeholder:text-muted-foreground/80',
              )}
            />
          </div>
          {streaming && onStop ? <StopButton onStop={onStop} /> : null}
          {VOICE_SUPPORTED && onOpenVoiceMode ? (
            <VoiceModeEntryButton onClick={onOpenVoiceMode} />
          ) : null}
          {VOICE_SUPPORTED ? (
            <VoiceButton
              isRecording={voice.isRecording}
              isTranscribing={voice.isTranscribing}
              onStart={() => {
                void voice.startRecording()
              }}
              onStop={() => {
                void voice.stopRecording()
              }}
            />
          ) : null}
          <InputActionButton
            disabled={
              !hasContent ||
              isStaging ||
              !!disabled ||
              voice.isRecording ||
              voice.isTranscribing ||
              (streaming && !queueAware)
            }
            onClick={handleSend}
            // Spinner stays the user-facing "agent is busy" hint; with the
            // queue active we still spin while a turn is in flight.
            streaming={streaming}
            hasContent={hasContent}
          />
        </div>
        {voice.error ? (
          <div className="px-5 pb-2 text-destructive text-xs">
            {voice.error}
          </div>
        ) : null}
        <CalmContextControls
          providers={providers}
          selectedProvider={selectedProvider}
          onSelectProvider={onSelectProvider}
          selectedTabs={selectedTabs}
          onToggleTab={toggleTab}
          showAgentSelector={variant === 'home'}
          onAttachClick={openFilePicker}
          attachDisabled={attachments.length >= 10 || isStaging || !!disabled}
          attachmentsEnabled={attachmentsEnabled}
        />
        {isDragOver ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-background/80 font-medium text-foreground text-sm backdrop-blur-sm">
            Drop files to attach
          </div>
        ) : null}
      </section>
    </Shell>
  )
}

function AttachmentStrip({
  attachments,
  onRemove,
  error,
}: {
  attachments: StagedAttachment[]
  onRemove: (id: string) => void
  error: string | null
}) {
  return (
    <div className="border-border/40 border-b px-4 pt-3 pb-2">
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() => onRemove(attachment.id)}
            />
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="mt-2 text-destructive text-xs">{error}</div>
      ) : null}
    </div>
  )
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: StagedAttachment
  onRemove: () => void
}) {
  if (attachment.kind === 'image' && attachment.dataUrl) {
    return (
      <div className="group relative size-16 overflow-hidden rounded-md border border-border/60">
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="size-full object-cover"
        />
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          aria-label={`Remove ${attachment.name}`}
        >
          <X className="size-3" />
        </button>
      </div>
    )
  }
  return (
    <div className="group flex max-w-[220px] items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
      <FileText className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-xs">{attachment.name}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 inline-flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={`Remove ${attachment.name}`}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

function BotInputIcon() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent-orange)]/10 text-[var(--accent-orange)]">
      <Bot className="h-4 w-4" />
    </div>
  )
}

function TargetPillIcon({ provider }: { provider: Provider }) {
  if (provider.kind === 'acp') return <Bot className="size-3" />
  if (provider.type === 'browseros') return <PaneIcon size={12} />
  return <ProviderIcon type={provider.type as ProviderType} size={12} />
}
