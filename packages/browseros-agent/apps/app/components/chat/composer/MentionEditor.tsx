import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// Serialized references keep a stable tab ID; the editor displays an atomic chip.
const mentionPattern = /@\[([^\]]+)\]\(tab:(\d+)\)/g
function serialize(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.mention)
    return node.dataset.mention
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeName === 'BR') return '\n'
  return Array.from(node.childNodes)
    .map(
      (child, index) =>
        `${index > 0 && (child.nodeName === 'DIV' || child.nodeName === 'P') ? '\n' : ''}${serialize(child)}`,
    )
    .join('')
}
function chip(token: string, label: string, id: string) {
  const span = document.createElement('span')
  span.contentEditable = 'false'
  span.dataset.mention = token
  span.className =
    'mx-0.5 inline-block max-w-full truncate rounded-md bg-muted px-1.5 align-middle text-[13px] text-foreground'
  span.textContent = `@${label}`
  span.title = `Tab ${id}: ${label}`
  return span
}
export interface MentionEditorHandle {
  focus: () => void
  openMention: () => void
  commit: (tab: chrome.tabs.Tab) => void
}
export const MentionEditor = forwardRef<
  MentionEditorHandle,
  {
    value: string
    onChange: (value: string) => void
    onMention: (query: string | null) => void
    onSubmit: () => void
    placeholder: string
    disabled?: boolean
    onFiles: (files: File[]) => void
  }
>(
  (
    { value, onChange, onMention, onSubmit, placeholder, disabled, onFiles },
    ref,
  ) => {
    const element = useRef<HTMLDivElement>(null)
    const rendered = useRef<string | undefined>(undefined)
    const mentionRange = useRef<Range | null>(null)
    const composing = useRef(false)
    function update() {
      if (!element.current) return
      const next = serialize(element.current)
      rendered.current = next
      onChange(next)
      const selection = window.getSelection()
      if (
        !selection?.isCollapsed ||
        !selection.anchorNode ||
        selection.anchorNode.nodeType !== Node.TEXT_NODE ||
        composing.current
      ) {
        onMention(null)
        return
      }
      const node = selection.anchorNode
      const before = (node.textContent ?? '').slice(0, selection.anchorOffset)
      const match = /(?:^|\s)@([^@\n]*)$/.exec(before)
      if (!match) {
        mentionRange.current = null
        onMention(null)
        return
      }
      const range = document.createRange()
      range.setStart(node, before.length - match[1].length - 1)
      range.setEnd(node, selection.anchorOffset)
      mentionRange.current = range
      onMention(match[1])
    }
    useEffect(() => {
      const el = element.current
      if (!el || rendered.current === value) return
      rendered.current = value
      el.replaceChildren()
      let offset = 0
      for (const match of value.matchAll(mentionPattern)) {
        el.append(document.createTextNode(value.slice(offset, match.index)))
        el.append(chip(match[0], match[1], match[2]))
        offset = (match.index ?? 0) + match[0].length
      }
      el.append(document.createTextNode(value.slice(offset)))
      if (document.activeElement === el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }, [value])
    useImperativeHandle(ref, () => ({
      focus: () => element.current?.focus(),
      openMention: () => {
        element.current?.focus()
        document.execCommand('insertText', false, '@')
        update()
      },
      commit: (tab) => {
        const range = mentionRange.current
        if (
          !range ||
          !element.current?.contains(range.startContainer) ||
          tab.id == null
        )
          return
        const label = (tab.title || tab.url || 'Page').replace(/[\]\n]/g, ' ')
        const token = `@[${label}](tab:${tab.id})`
        const span = chip(token, label, String(tab.id))
        element.current.focus()
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        // Chromium records this insertion as one native undo operation.
        // outerHTML is created with textContent, so tab titles cannot inject markup.
        if (!document.execCommand('insertHTML', false, `${span.outerHTML} `))
          return
        mentionRange.current = null
        update()
        onMention(null)
      },
    }))
    return (
      // biome-ignore lint/a11y/useSemanticElements: A contenteditable textbox supports atomic inline tab references.
      <div
        tabIndex={0}
        ref={element}
        role="textbox"
        aria-label="Message Pane"
        aria-multiline="true"
        aria-disabled={disabled}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className="max-h-52 min-h-14 w-full overflow-y-auto whitespace-pre-wrap break-words px-1 py-2 text-sm leading-6 outline-none empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
        onInput={update}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          update()
        }}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            !composing.current
          ) {
            event.preventDefault()
            onSubmit()
          }
          if (event.key === 'Escape') {
            mentionRange.current = null
            onMention(null)
          }
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          if (files.length) {
            event.preventDefault()
            onFiles(files)
            return
          }
          // Paste plain text only: no remote markup, formatting, or hidden context.
          event.preventDefault()
          document.execCommand(
            'insertText',
            false,
            event.clipboardData.getData('text/plain'),
          )
          update()
        }}
      />
    )
  },
)
MentionEditor.displayName = 'MentionEditor'
