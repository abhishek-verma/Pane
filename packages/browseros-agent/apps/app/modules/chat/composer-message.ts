import type { UIMessage } from 'ai'
import type {
  ServerAttachmentPayload,
  StagedAttachment,
} from '@/lib/attachments'
import type { ChatAction } from '@/lib/chat-actions/types'
import type { SelectedTextData } from '@/lib/selected-text/selectedTextStorage'
import type { ChatMode } from './chat-types'

export interface ComposerMessage {
  text: string
  action?: ChatAction
  attachments?: StagedAttachment[]
  mode?: ChatMode
  selection?: SelectedTextData | null
  revision?: { conversationId: string; messageId: string }
}

export interface ComposerMetadata {
  action?: ChatAction
  mode?: ChatMode
  selection?: SelectedTextData | null
  revision?: ComposerMessage['revision']
}

export function composerMetadata(
  message: UIMessage | undefined,
): ComposerMetadata | undefined {
  return (message?.metadata as { composer?: ComposerMetadata } | undefined)
    ?.composer
}

export function composerFileParts(
  attachments: StagedAttachment[] = [],
): UIMessage['parts'] {
  return attachments.map(({ payload, name }) => ({
    type: 'file' as const,
    mediaType: payload.kind === 'file' ? 'text/plain' : payload.mediaType,
    filename: name,
    url:
      payload.kind === 'file'
        ? `data:text/plain;base64,${btoa(Array.from(new TextEncoder().encode(payload.text), (byte) => String.fromCharCode(byte)).join(''))}`
        : payload.dataUrl,
  }))
}

export function messageAttachments(
  message: UIMessage | undefined,
): StagedAttachment[] {
  return (message?.parts ?? []).flatMap((part, index) => {
    if (part.type !== 'file' || !part.url.startsWith('data:')) return []
    const name = part.filename ?? 'Attachment'
    let payload: ServerAttachmentPayload
    if (part.mediaType === 'text/plain') {
      const text = new TextDecoder().decode(
        Uint8Array.from(atob(part.url.split(',')[1]), (char) =>
          char.charCodeAt(0),
        ),
      )
      payload = { kind: 'file', name, mediaType: part.mediaType, text }
    } else if (part.mediaType === 'application/pdf') {
      payload = {
        kind: 'document',
        name,
        mediaType: part.mediaType,
        dataUrl: part.url,
      }
    } else {
      payload = {
        kind: 'image',
        name,
        mediaType: part.mediaType,
        dataUrl: part.url,
      }
    }
    return [
      {
        id: `${message?.id}-${index}`,
        kind: payload.kind === 'image' ? ('image' as const) : ('file' as const),
        name,
        mediaType: part.mediaType,
        dataUrl: payload.kind === 'file' ? undefined : part.url,
        payload,
      },
    ]
  })
}

export function readableMessageText(text: string): string {
  return text.replace(/@\[([^\]]+)\]\(tab:\d+\)/g, '@$1')
}
