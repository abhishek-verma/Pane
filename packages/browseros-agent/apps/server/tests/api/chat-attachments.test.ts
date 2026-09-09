import { describe, expect, it } from 'bun:test'
import {
  attachmentParts,
  ChatAttachmentsSchema,
  harnessAttachments,
  withReadableTextFiles,
} from '../../src/api/chat-attachments'

describe('chat attachments across transports', () => {
  const text = {
    kind: 'file' as const,
    mediaType: 'text/plain',
    name: 'notes.md',
    text: 'Hello 世界\nSecond line',
  }
  it('preserves a text document in history and makes it readable by every model', () => {
    const parts = attachmentParts([text])
    expect(parts[0]).toMatchObject({ type: 'file', filename: 'notes.md' })
    const model = withReadableTextFiles([{ id: 'a', role: 'user', parts }])
    expect(model[0].parts[0]).toEqual({
      type: 'text',
      text: 'Attached file "notes.md":\nHello 世界\nSecond line',
    })
    expect(parts[0].type).toBe('file')
  })
  it('accepts text in the harness contract and preserves images', () => {
    const image = {
      kind: 'image' as const,
      name: 'image.png',
      mediaType: 'image/png' as const,
      dataUrl: 'data:image/png;base64,YQ==',
    }
    expect(ChatAttachmentsSchema.safeParse([text, image]).success).toBe(true)
    expect(harnessAttachments([text, image])).toEqual({
      text: '\n\nAttached file "notes.md":\nHello 世界\nSecond line',
      images: [{ mediaType: 'image/png', data: 'YQ==' }],
    })
  })
  it('rejects MIME spoofing, malformed data and text that exceeds the byte limit', () => {
    expect(
      ChatAttachmentsSchema.safeParse([
        {
          kind: 'image',
          mediaType: 'image/png',
          dataUrl: 'data:image/jpeg;base64,YQ==',
        },
      ]).success,
    ).toBe(false)
    expect(
      ChatAttachmentsSchema.safeParse([
        {
          kind: 'image',
          mediaType: 'image/png',
          dataUrl: 'https://example.com/image.png',
        },
      ]).success,
    ).toBe(false)
    expect(
      ChatAttachmentsSchema.safeParse([{ ...text, text: '界'.repeat(400_000) }])
        .success,
    ).toBe(false)
  })
  it('keeps PDF as a document for LLMs and explicitly rejects unsupported harness input', () => {
    const pdf = {
      kind: 'document' as const,
      mediaType: 'application/pdf' as const,
      name: 'brief.pdf',
      dataUrl: 'data:application/pdf;base64,JVBERi0=',
    }
    expect(ChatAttachmentsSchema.safeParse([pdf]).success).toBe(true)
    expect(attachmentParts([pdf])[0]).toMatchObject({
      mediaType: 'application/pdf',
      filename: 'brief.pdf',
    })
    expect(() => harnessAttachments([pdf])).toThrow('PDF input requires')
  })
})
