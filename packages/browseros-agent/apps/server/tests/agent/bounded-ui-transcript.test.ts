import { expect, test } from 'bun:test'
import { uiContentPage } from '@browseros/shared/ui-content-page'
import {
  boundUiTranscript,
  contentPreview,
  UI_MESSAGE_PARTS,
  UI_TRANSCRIPT_BYTES,
} from '@browseros/shared/ui-transcript-window'
import { createLiveUiWindow } from '../../src/agent/bound-live-ui-chunks'

test('multi-megabyte text/reasoning and 20,000 parts have bounded, stable resident state', () => {
  const reply =
    '## Research\n\n*r/samsung (285 comments)*\n\nThe useful conclusion.'
  const text = '漢😀\u0000'.repeat(500_000)
  const messages = [
    {
      id: 'long-turn',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text },
        ...Array.from({ length: 20_000 }, (_, i) => ({
          type: 'tool-read',
          state: 'output-available',
          toolCallId: `tool-${i}`,
          input: {},
          output: 'x'.repeat(2000),
        })),
        { type: 'text', text },
        { type: 'text', text: reply },
      ],
    },
  ]
  const result = boundUiTranscript(messages)
  expect(result[0].parts.length).toBeLessThanOrEqual(UI_MESSAGE_PARTS)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
    UI_TRANSCRIPT_BYTES,
  )
  expect(result[0].parts.some((part) => part.text === reply)).toBe(true)
  expect(contentPreview(result[0])?.totalParts).toBe(20_003)
  expect(boundUiTranscript(result) === result).toBe(true)
  expect(messages[0].parts.length).toBe(20_003)
  expect(messages[0].parts[0].text?.length).toBe(text.length)
})

test('aggregate bytes are bounded across the resident message window', () => {
  const messages = Array.from({ length: 80 }, (_, index) => ({
    id: `${index}`,
    role: 'assistant',
    parts: [{ type: 'text', text: '\u0000'.repeat(500_000) }],
  }))
  const next = boundUiTranscript(messages)
  expect(next).toHaveLength(60)
  expect(Buffer.byteLength(JSON.stringify(next))).toBeLessThan(
    UI_TRANSCRIPT_BYTES,
  )
  expect((next[0] as { uiHistoryBefore?: boolean }).uiHistoryBefore).toBe(true)
  expect(boundUiTranscript(next) === next).toBe(true)
})

test('full text and reasoning can be read losslessly one bounded page at a time', () => {
  for (const type of ['text', 'reasoning']) {
    const text = '漢😀\u0000'.repeat(80_000)
    const parts = [{ type, text }]
    let cursor: { part: number; offset: number } | undefined
    let restored = ''
    do {
      const page = uiContentPage(parts, cursor)!
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(64_000)
      restored += page.part.text
      cursor = page.next ?? undefined
    } while (cursor)
    expect(restored === text).toBe(true)
    expect(parts[0].text === text).toBe(true)
  }
})

test('stream wire window bounds huge deltas and thousands of tools before the SDK sees them', () => {
  const project = createLiveUiWindow()
  const wire: Record<string, unknown>[] = []
  const emit = (chunk: Record<string, unknown>) => wire.push(...project(chunk))
  emit({ type: 'start', messageId: 'm' })
  emit({ type: 'reasoning-start', id: 'r' })
  emit({ type: 'reasoning-delta', id: 'r', delta: 'x'.repeat(5_000_000) })
  emit({ type: 'reasoning-end', id: 'r' })
  emit({ type: 'text-start', id: 't' })
  emit({ type: 'text-delta', id: 't', delta: '\u0000'.repeat(5_000_000) })
  emit({ type: 'text-end', id: 't' })
  for (let i = 0; i < 1000; i++) {
    emit({
      type: 'tool-input-start',
      toolCallId: `call-${i}`,
      toolName: 'read',
    })
    emit({
      type: 'tool-input-delta',
      toolCallId: `call-${i}`,
      inputTextDelta: 'x'.repeat(30_000),
    })
    emit({
      type: 'tool-input-available',
      toolCallId: `call-${i}`,
      toolName: 'read',
      input: { body: 'x'.repeat(30_000) },
    })
    emit({
      type: 'tool-output-available',
      toolCallId: `call-${i}`,
      output: 'x'.repeat(30_000),
    })
  }
  expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(
    UI_TRANSCRIPT_BYTES,
  )
  expect(
    wire.filter((chunk) => chunk.type === 'tool-input-available').length,
  ).toBe(48)
  expect(wire.some((chunk) => chunk.type === 'tool-input-delta')).toBe(false)
})

test('text overflow before a large approval input aggregates all marker revisions safely', () => {
  const project = createLiveUiWindow()
  project({ type: 'text-start', id: 't' })
  const textChunks = project({
    type: 'text-delta',
    id: 't',
    delta: 'x'.repeat(1_000_000),
  })
  const inputChunks = project({
    type: 'tool-input-available',
    toolCallId: 'approval-call',
    toolName: 'write',
    input: { body: 'x'.repeat(1_000_000) },
  })
  const markers = [...textChunks, ...inputChunks].filter(
    (part) => part.type === 'data-pane-content-preview',
  )
  expect(markers).toHaveLength(2)
  const available = inputChunks.find(
    (chunk) => chunk.type === 'tool-input-available',
  )!
  const messages = [
    {
      id: 'm',
      role: 'assistant',
      parts: [
        ...(markers as { type: string }[]),
        {
          type: 'tool-write',
          toolCallId: 'approval-call',
          state: 'approval-requested',
          approval: { id: 'approval' },
          input: available.input,
        },
      ],
    },
  ]
  const next = boundUiTranscript(messages)
  expect(
    next[0].parts.find((part) => part.type === 'tool-write'),
  ).toMatchObject({ inputPreviewed: true })
  expect(boundUiTranscript(next) === next).toBe(true)
})

test('the real SDK retains a bounded message and identifies a previewed pending approval', async () => {
  const { readUIMessageStream } = await import('ai')
  const project = createLiveUiWindow()
  const raw = [
    { type: 'start', messageId: 'message' },
    { type: 'text-start', id: 'text' },
    { type: 'text-delta', id: 'text', delta: 'x'.repeat(3_000_000) },
    { type: 'text-end', id: 'text' },
    { type: 'tool-input-start', toolCallId: 'write', toolName: 'write' },
    {
      type: 'tool-input-delta',
      toolCallId: 'write',
      inputTextDelta: '{"body":"' + 'x'.repeat(3_000_000) + '"}',
    },
    {
      type: 'tool-input-available',
      toolCallId: 'write',
      toolName: 'write',
      input: { body: 'x'.repeat(3_000_000) },
    },
    {
      type: 'tool-approval-request',
      toolCallId: 'write',
      approvalId: 'approve',
    },
    { type: 'finish', finishReason: 'tool-calls' },
  ]
  const wire = raw.flatMap(project)
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of wire) controller.enqueue(chunk)
      controller.close()
    },
  })
  let latest: import('ai').UIMessage | undefined
  for await (const message of readUIMessageStream({
    stream: stream as never,
    terminateOnError: true,
  })) {
    latest = message
    expect(Buffer.byteLength(JSON.stringify(message))).toBeLessThan(
      UI_TRANSCRIPT_BYTES,
    )
  }
  expect(latest).toBeDefined()
  const resident = boundUiTranscript([latest!])
  expect(
    resident[0].parts.find((part) => part.type === 'tool-write'),
  ).toMatchObject({
    inputPreviewed: true,
    state: 'approval-requested',
    approval: { id: 'approve' },
  })
})

test('a marker projected before its input arrives keeps later approval arguments non-executable', () => {
  const early = boundUiTranscript([
    {
      id: 'm',
      role: 'assistant',
      parts: [
        {
          type: 'data-pane-content-preview',
          id: 'pane-content-preview',
          data: { inputPreviewIds: ['later'] },
        },
      ],
    },
  ])
  const arrived = [
    {
      ...early[0],
      parts: [
        ...early[0].parts,
        {
          type: 'tool-write',
          toolCallId: 'later',
          state: 'approval-requested',
          input: { preview: 'Only a preview' },
          approval: { id: 'approval' },
        },
      ],
    },
  ]
  const next = boundUiTranscript(arrived)
  expect(
    next[0].parts.find((part) => part.type === 'tool-write'),
  ).toMatchObject({ inputPreviewed: true })
  expect(boundUiTranscript(next) === next).toBe(true)
})
