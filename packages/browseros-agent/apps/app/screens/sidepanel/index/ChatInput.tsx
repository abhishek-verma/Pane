import {
  ArrowUp,
  AudioLines,
  ListPlus,
  Loader2,
  Mic,
  Square,
} from 'lucide-react'
import {
  type FormEvent,
  forwardRef,
  type ReactNode,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  MentionEditor,
  type MentionEditorHandle,
} from '@/components/chat/composer/MentionEditor'
import { TabPickerPopover } from '@/components/elements/tab-picker-popover'
import { VOICE_SUPPORTED } from '@/lib/voice/voice-supported'
import type { ChatMode } from '@/modules/chat/chat-types'
import type { VoiceInputState } from '@/modules/voice/voice.hooks'

interface ChatInputProps {
  input: string
  status: 'streaming' | 'submitted' | 'ready' | 'error'
  mode: ChatMode
  onInputChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onStop: () => void
  isTurnActive?: boolean
  sendDisabled?: boolean
  selectedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  onTabMentionOpenChange?: (open: boolean) => void
  voice?: VoiceInputState
  onOpenVoiceMode?: () => void
  controls?: ReactNode
  hasAttachments?: boolean
  onFiles?: (files: File[]) => void
  preparing?: boolean
}
export interface ChatInputHandle {
  openTabMention: () => void
  closeTabMention: () => void
  toggleTabMention: () => void
  focus: () => void
}
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  (props, ref) => {
    const editor = useRef<MentionEditorHandle>(null)
    const seenTabs = useRef(new Map<number, chrome.tabs.Tab>())
    for (const tab of props.selectedTabs)
      if (tab.id != null) seenTabs.current.set(tab.id, tab)
    const anchor = useRef<HTMLDivElement>(null)
    const form = useRef<HTMLFormElement>(null)
    const [query, setQuery] = useState<string | null>(null)
    const busy =
      props.isTurnActive ||
      props.status === 'submitted' ||
      props.status === 'streaming'
    const canSubmit =
      !props.sendDisabled &&
      !props.preparing &&
      !props.voice?.isRecording &&
      !props.voice?.isTranscribing &&
      (!!props.input.trim() || props.hasAttachments)
    function closeMention() {
      setQuery(null)
      props.onTabMentionOpenChange?.(false)
    }
    useImperativeHandle(ref, () => ({
      openTabMention: () => editor.current?.openMention(),
      closeTabMention: closeMention,
      toggleTabMention: () =>
        query === null ? editor.current?.openMention() : closeMention(),
      focus: () => editor.current?.focus(),
    }))
    return (
      <form
        ref={form}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit && query === null) props.onSubmit(event)
        }}
      >
        <div ref={anchor}>
          <TabPickerPopover
            variant="mention"
            isOpen={query !== null}
            filterText={query ?? ''}
            selectedTabs={props.selectedTabs}
            onToggleTab={(tab) => {
              if (!props.selectedTabs.some((item) => item.id === tab.id))
                props.onToggleTab(tab)
              editor.current?.commit(tab)
              closeMention()
            }}
            onClose={closeMention}
            anchorRef={anchor}
          />
          <MentionEditor
            ref={editor}
            value={props.input}
            onChange={(value) => {
              const ids = new Set(
                [...value.matchAll(/@\[[^\]]+\]\(tab:(\d+)\)/g)].map((match) =>
                  Number(match[1]),
                ),
              )
              for (const id of ids) {
                const tab = seenTabs.current.get(id)
                if (
                  tab &&
                  !props.selectedTabs.some((selected) => selected.id === id)
                )
                  props.onToggleTab(tab)
              }
              props.onInputChange(value)
            }}
            onMention={(value) => {
              setQuery(value)
              props.onTabMentionOpenChange?.(value !== null)
            }}
            onSubmit={() => {
              if (query === null) form.current?.requestSubmit()
            }}
            onFiles={props.onFiles ?? (() => {})}
            placeholder={busy ? 'Add a follow-up…' : 'Ask anything, or @ a tab'}
            disabled={props.voice?.isTranscribing}
          />
        </div>
        <div className="flex items-center gap-1 pt-1">
          {props.controls}
          <div className="flex-1" />
          {busy && (
            <button
              type="button"
              onClick={props.onStop}
              aria-label="Stop response"
              title="Stop response"
              className="rounded-full border border-border p-2 hover:bg-muted"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          )}
          {VOICE_SUPPORTED && props.onOpenVoiceMode && (
            <button
              type="button"
              onClick={props.onOpenVoiceMode}
              aria-label="Voice mode"
              className="rounded-full p-2 text-muted-foreground hover:bg-muted"
            >
              <AudioLines className="size-4" />
            </button>
          )}
          {VOICE_SUPPORTED && props.voice && (
            <button
              type="button"
              disabled={props.voice.isTranscribing}
              onClick={
                props.voice.isRecording
                  ? props.voice.onStopRecording
                  : props.voice.onStartRecording
              }
              aria-label={
                props.voice.isRecording ? 'Stop recording' : 'Dictate message'
              }
              className="rounded-full p-2 text-muted-foreground hover:bg-muted"
            >
              {props.voice.isTranscribing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : props.voice.isRecording ? (
                <Square className="size-4 text-destructive" />
              ) : (
                <Mic className="size-4" />
              )}
            </button>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label={busy ? 'Queue message' : 'Send message'}
            title={busy ? 'Queue message · Enter' : 'Send message · Enter'}
            className="rounded-full bg-foreground p-2 text-background transition-opacity hover:opacity-80 disabled:opacity-25"
          >
            {props.preparing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : busy ? (
              <ListPlus className="size-4" />
            ) : (
              <ArrowUp className="size-4" />
            )}
          </button>
        </div>
      </form>
    )
  },
)
ChatInput.displayName = 'ChatInput'
