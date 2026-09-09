import type { UIMessage } from 'ai'
import { z } from 'zod'

const imageTypes = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
] as const
const dataUrl = z
  .string()
  .max(7 * 1024 * 1024)
  .regex(/^data:[\w/+.-]+;base64,[A-Za-z0-9+/]+={0,2}$/)
export const ChatAttachmentsSchema = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('image'),
        mediaType: z.enum(imageTypes),
        name: z.string().max(512).optional(),
        dataUrl,
      }),
      z.object({
        kind: z.literal('document'),
        mediaType: z.literal('application/pdf'),
        name: z.string().max(512),
        dataUrl,
      }),
      z.object({
        kind: z.literal('file'),
        mediaType: z.string().max(128),
        name: z.string().max(512),
        text: z
          .string()
          .refine(
            (value) => Buffer.byteLength(value, 'utf8') <= 1024 * 1024,
            'Text attachment exceeds 1 MB',
          ),
      }),
    ]),
  )
  .max(10)
  .superRefine((items, context) => {
    for (const [index, item] of items.entries()) {
      if (
        item.kind !== 'file' &&
        !item.dataUrl.startsWith(`data:${item.mediaType};base64,`)
      ) {
        context.addIssue({
          code: 'custom',
          path: [index, 'dataUrl'],
          message: 'Attachment MIME type does not match its data URL',
        })
      }
    }
  })

export type ChatAttachments = z.infer<typeof ChatAttachmentsSchema>

/** Preserve files in both the transcript and the actual model input. */
export function attachmentParts(
  attachments: ChatAttachments = [],
): UIMessage['parts'] {
  return attachments.map((item) => ({
    type: 'file' as const,
    mediaType: item.kind === 'file' ? 'text/plain' : item.mediaType,
    filename: item.name ?? 'Image',
    url:
      item.kind === 'file'
        ? `data:text/plain;base64,${Buffer.from(item.text).toString('base64')}`
        : item.dataUrl,
  }))
}

/** Text documents work with every model; binary images/PDF remain file parts. */
export function withReadableTextFiles(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) =>
    message.role !== 'user'
      ? message
      : {
          ...message,
          parts: message.parts.map((part) =>
            part.type === 'file' &&
            part.mediaType === 'text/plain' &&
            part.url.startsWith('data:text/plain;base64,')
              ? {
                  type: 'text' as const,
                  text: `Attached file ${JSON.stringify(part.filename ?? 'file')}:\n${Buffer.from(part.url.slice(part.url.indexOf(',') + 1), 'base64').toString('utf8')}`,
                }
              : part,
          ),
        },
  )
}

/** ACP supports images and text, but has no PDF document input contract. */
export function harnessAttachments(attachments: ChatAttachments = []) {
  if (attachments.some((item) => item.kind === 'document'))
    throw new Error(
      'PDF input requires an LLM provider with PDF support. Choose a compatible provider or attach extracted text.',
    )
  return {
    text: attachments
      .filter((item) => item.kind === 'file')
      .map(
        (item) =>
          `\n\nAttached file ${JSON.stringify(item.name)}:\n${item.text}`,
      )
      .join(''),
    images: attachments.flatMap((item) =>
      item.kind === 'image'
        ? [
            {
              mediaType: item.mediaType,
              data: item.dataUrl.slice(item.dataUrl.indexOf(',') + 1),
            },
          ]
        : [],
    ),
  }
}
