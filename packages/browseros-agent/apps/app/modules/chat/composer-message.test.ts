import { describe, expect, it } from 'bun:test'
import type { UIMessage } from 'ai'
import {
  composerFileParts,
  composerMetadata,
  messageAttachments,
} from './composer-message'

describe('composer message payloads', () => {
  it('round-trips Unicode text, images and PDFs through transcript parts', () => {
    const message: UIMessage = {
      id: 'test',
      role: 'user',
      parts: composerFileParts([
        {
          id: 'txt',
          kind: 'file',
          name: 'notes.md',
          mediaType: 'text/plain',
          payload: {
            kind: 'file',
            name: 'notes.md',
            mediaType: 'text/plain',
            text: '世界\n🌍',
          },
        },
        {
          id: 'img',
          kind: 'image',
          name: 'shot.png',
          mediaType: 'image/png',
          payload: {
            kind: 'image',
            name: 'shot.png',
            mediaType: 'image/png',
            dataUrl: 'data:image/png;base64,AQID',
          },
        },
        {
          id: 'pdf',
          kind: 'file',
          name: 'brief.pdf',
          mediaType: 'application/pdf',
          payload: {
            kind: 'document',
            name: 'brief.pdf',
            mediaType: 'application/pdf',
            dataUrl: 'data:application/pdf;base64,JVBERi0=',
          },
        },
      ]),
    }
    const attached = messageAttachments(message)
    expect(attached[0].payload).toMatchObject({
      kind: 'file',
      text: '世界\n🌍',
    })
    expect(attached[1].payload).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,AQID',
    })
    expect(attached[2].payload.kind).toBe('document')
  })
  it('binds context to the message identity even for repeated prompt text', () => {
    const first: UIMessage = {
      id: 'a',
      role: 'user',
      parts: [{ type: 'text', text: 'Compare these' }],
      metadata: { composer: { action: { id: 'page-a' } } },
    }
    const second: UIMessage = {
      ...first,
      id: 'b',
      metadata: { composer: { action: { id: 'page-b' } } },
    }
    expect(composerMetadata(first)?.action?.id).toBe('page-a')
    expect(composerMetadata(second)?.action?.id).toBe('page-b')
  })
})
