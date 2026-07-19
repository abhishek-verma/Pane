/**
 * @license
 * Copyright 2025 BrowserOS
 *
 * Message Validation — Test Suite
 *
 * Tests for sanitizeMessagesForToolset, which strips tool parts from
 * carried-over messages when a session is rebuilt with a different toolset
 * (e.g., workspace removed or MCP server disconnected mid-conversation).
 *
 * Without this sanitization, the AI SDK throws a validation error because
 * it finds tool parts in the message history that have no matching schema.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import {
  hasMessageContent,
  sanitizeMessagesForToolset,
  stripUIImageOutputs,
} from '../../src/agent/message-validation'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserMessage(text: string, id?: string): UIMessage {
  return {
    id: id ?? crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function makeAssistantMessage(
  parts: UIMessage['parts'],
  id?: string,
): UIMessage {
  return {
    id: id ?? crypto.randomUUID(),
    role: 'assistant',
    parts,
  }
}

/** Minimal ToolImageStore stub that captures stored blobs in-memory. */
class MockImageStore {
  stored: Array<{
    sessionId: string
    toolCallId: string
    data: string
    mimeType: string
  }> = []

  store(
    sessionId: string,
    toolCallId: string,
    data: string,
    mimeType: string,
  ): void {
    this.stored.push({ sessionId, toolCallId, data, mimeType })
  }

  get(_toolCallId: string): null {
    return null
  }

  deleteForSession(_sessionId: string): void {}
}

function makeScreenshotPart(
  toolCallId: string,
  imageData: string,
  mimeType = 'image/jpeg',
): UIMessage['parts'][number] {
  return {
    type: 'tool-screenshot',
    toolCallId,
    toolName: 'screenshot',
    state: 'result',
    input: { page: 1 },
    output: {
      content: [{ type: 'image', data: imageData, mimeType }],
      isError: false,
      structuredContent: { page: 1, format: 'jpeg', bytes: 100 },
    },
  } as unknown as UIMessage['parts'][number]
}

// ---------------------------------------------------------------------------
// stripUIImageOutputs
// ---------------------------------------------------------------------------

describe('stripUIImageOutputs', () => {
  it('does nothing when all assistant messages are within keepRecentN', () => {
    const store = new MockImageStore()
    const messages: UIMessage[] = [
      makeUserMessage('Do browser stuff'),
      makeAssistantMessage([makeScreenshotPart('c1', 'AAAA')]),
    ]

    stripUIImageOutputs(messages, 'sess-1', store as never, 3)

    // Only 1 assistant message, keepRecentN=3 → nothing stripped
    expect(store.stored).toHaveLength(0)
    const part = messages[1]?.parts[0] as Record<string, unknown>
    const output = part.output as Record<string, unknown>
    const content = output.content as Array<Record<string, unknown>>
    expect(content[0]?.data).toBe('AAAA')
  })

  it('strips image data from old assistant messages beyond keepRecentN', () => {
    const store = new MockImageStore()
    const imgData = 'BASE64_DATA_FOR_OLD_MSG'
    const messages: UIMessage[] = [
      makeUserMessage('turn 1'),
      makeAssistantMessage([makeScreenshotPart('c1', imgData)]), // old → stripped
      makeAssistantMessage([makeScreenshotPart('c2', imgData)]), // old → stripped
      makeUserMessage('turn 2'),
      makeAssistantMessage([makeScreenshotPart('c3', 'RECENT_3')]), // recent (3rd newest) → kept
      makeUserMessage('turn 3'),
      makeAssistantMessage([makeScreenshotPart('c4', 'RECENT_2')]), // recent (2nd newest) → kept
      makeUserMessage('turn 4'),
      makeAssistantMessage([makeScreenshotPart('c5', 'RECENT_1')]), // most recent → kept
    ]

    stripUIImageOutputs(messages, 'sess-1', store as never, 3)

    // Messages at index 1 and 2 (c1, c2) should be stripped (order: newest-first walk)
    expect(store.stored).toHaveLength(2)
    const storedIds = store.stored.map((s) => s.toolCallId).sort()
    expect(storedIds).toEqual(['c1', 'c2'])
    expect(store.stored[0]?.data).toBe(imgData)

    // Stripped parts should have stripped:true and no data field
    const oldPart = messages[1]?.parts[0] as Record<string, unknown>
    const oldContent = (oldPart.output as Record<string, unknown>)
      .content as Array<Record<string, unknown>>
    expect(oldContent[0]?.stripped).toBe(true)
    expect(oldContent[0]?.data).toBeUndefined()
    expect(oldContent[0]?.type).toBe('image')

    // Recent messages should keep their data intact
    const recentPart = messages[8]?.parts[0] as Record<string, unknown>
    const recentContent = (recentPart.output as Record<string, unknown>)
      .content as Array<Record<string, unknown>>
    expect(recentContent[0]?.data).toBe('RECENT_1')
    expect(recentContent[0]?.stripped).toBeUndefined()
  })

  it('mutates messages in-place', () => {
    const store = new MockImageStore()
    const messages: UIMessage[] = [
      makeUserMessage('u1'),
      makeAssistantMessage([makeScreenshotPart('c1', 'OLD')]),
      makeUserMessage('u2'),
      makeAssistantMessage([makeScreenshotPart('c2', 'RECENT_1')]),
      makeUserMessage('u3'),
      makeAssistantMessage([makeScreenshotPart('c3', 'RECENT_2')]),
      makeUserMessage('u4'),
      makeAssistantMessage([makeScreenshotPart('c4', 'RECENT_3')]),
    ]
    const original = messages[1]
    stripUIImageOutputs(messages, 'sess-x', store as never, 3)

    // Same array reference modified in-place
    expect(messages[1]).toBe(original)
    // But output was mutated
    expect(store.stored).toHaveLength(1)
    expect(store.stored[0]?.toolCallId).toBe('c1')
  })

  it('stores image data with correct sessionId and mimeType', () => {
    const store = new MockImageStore()
    const messages: UIMessage[] = [
      makeUserMessage('u'),
      makeAssistantMessage([makeScreenshotPart('c1', 'DATA1', 'image/png')]),
      makeUserMessage('u2'),
      makeAssistantMessage([makeScreenshotPart('c2', 'RECENT1')]),
      makeUserMessage('u3'),
      makeAssistantMessage([makeScreenshotPart('c3', 'RECENT2')]),
      makeUserMessage('u4'),
      makeAssistantMessage([makeScreenshotPart('c4', 'RECENT3')]),
    ]

    stripUIImageOutputs(messages, 'my-session', store as never, 3)

    expect(store.stored[0]?.sessionId).toBe('my-session')
    expect(store.stored[0]?.mimeType).toBe('image/png')
  })

  it('skips non-image content items', () => {
    const store = new MockImageStore()
    const textPart = {
      type: 'tool-snapshot',
      toolCallId: 'c1',
      toolName: 'snapshot',
      state: 'result',
      input: {},
      output: {
        content: [{ type: 'text', text: 'page snapshot text...' }],
        isError: false,
      },
    } as unknown as UIMessage['parts'][number]

    const messages: UIMessage[] = [
      makeUserMessage('u'),
      makeAssistantMessage([textPart]),
      makeUserMessage('u2'),
      makeAssistantMessage([makeScreenshotPart('c2', 'RECENT1')]),
      makeUserMessage('u3'),
      makeAssistantMessage([makeScreenshotPart('c3', 'RECENT2')]),
      makeUserMessage('u4'),
      makeAssistantMessage([makeScreenshotPart('c4', 'RECENT3')]),
    ]

    stripUIImageOutputs(messages, 'sess', store as never, 3)

    // Snapshot (text) part not stored; no image stripping happened
    expect(store.stored).toHaveLength(0)
    const part = messages[1]?.parts[0] as Record<string, unknown>
    const output = part.output as Record<string, unknown>
    const content = output.content as Array<Record<string, unknown>>
    expect(content[0]?.text).toBe('page snapshot text...')
  })

  it('handles empty messages array without error', () => {
    const store = new MockImageStore()
    expect(() =>
      stripUIImageOutputs([], 'sess', store as never, 3),
    ).not.toThrow()
    expect(store.stored).toHaveLength(0)
  })

  it('strips multiple images within the same tool part', () => {
    const store = new MockImageStore()
    const part = {
      type: 'tool-act',
      toolCallId: 'c1',
      toolName: 'act',
      state: 'result',
      input: { kind: 'click', ref: 'e1' },
      output: {
        content: [
          { type: 'text', text: '[Page 1 screenshot]' },
          { type: 'image', data: 'PNG_1', mimeType: 'image/png' },
          { type: 'image', data: 'PNG_2', mimeType: 'image/png' },
        ],
        isError: false,
      },
    } as unknown as UIMessage['parts'][number]

    const messages: UIMessage[] = [
      makeUserMessage('u1'),
      makeAssistantMessage([part]),
      makeUserMessage('u2'),
      makeAssistantMessage([makeScreenshotPart('c2', 'R1')]),
      makeUserMessage('u3'),
      makeAssistantMessage([makeScreenshotPart('c3', 'R2')]),
      makeUserMessage('u4'),
      makeAssistantMessage([makeScreenshotPart('c4', 'R3')]),
    ]

    stripUIImageOutputs(messages, 'sess', store as never, 3)

    // Both images in the single old tool part are stripped
    expect(store.stored).toHaveLength(2)
    const anyPart = messages[1]?.parts[0] as Record<string, unknown>
    const content = (anyPart.output as Record<string, unknown>)
      .content as Array<Record<string, unknown>>
    expect(content[1]?.stripped).toBe(true)
    expect(content[1]?.data).toBeUndefined()
    expect(content[2]?.stripped).toBe(true)
    expect(content[2]?.data).toBeUndefined()
  })

  it('skips parts with no toolCallId (malformed)', () => {
    const store = new MockImageStore()
    const badPart = {
      type: 'tool-screenshot',
      // no toolCallId
      toolName: 'screenshot',
      state: 'result',
      input: {},
      output: {
        content: [{ type: 'image', data: 'DATA', mimeType: 'image/jpeg' }],
      },
    } as unknown as UIMessage['parts'][number]

    const messages: UIMessage[] = [
      makeUserMessage('u'),
      makeAssistantMessage([badPart]),
      makeUserMessage('u2'),
      makeAssistantMessage([makeScreenshotPart('c2', 'R1')]),
      makeUserMessage('u3'),
      makeAssistantMessage([makeScreenshotPart('c3', 'R2')]),
      makeUserMessage('u4'),
      makeAssistantMessage([makeScreenshotPart('c4', 'R3')]),
    ]

    // Should not throw; image is not stored because toolCallId is missing
    expect(() =>
      stripUIImageOutputs(messages, 'sess', store as never, 3),
    ).not.toThrow()
    expect(store.stored).toHaveLength(0)
  })

  it('is idempotent — calling twice does not double-store', () => {
    const store = new MockImageStore()
    const messages: UIMessage[] = [
      makeUserMessage('u1'),
      makeAssistantMessage([makeScreenshotPart('c1', 'DATA')]),
      makeUserMessage('u2'),
      makeAssistantMessage([makeScreenshotPart('c2', 'R1')]),
      makeUserMessage('u3'),
      makeAssistantMessage([makeScreenshotPart('c3', 'R2')]),
      makeUserMessage('u4'),
      makeAssistantMessage([makeScreenshotPart('c4', 'R3')]),
    ]

    stripUIImageOutputs(messages, 'sess', store as never, 3)
    // First call strips c1 (1 stored)
    expect(store.stored).toHaveLength(1)

    // Second call: c1 already has stripped:true and no data — nothing new stored
    stripUIImageOutputs(messages, 'sess', store as never, 3)
    expect(store.stored).toHaveLength(1)
  })

  it('user messages are never stripped regardless of position', () => {
    const store = new MockImageStore()
    // Simulate a user message that happens to have image-like content
    const userMsg: UIMessage = {
      id: 'u1',
      role: 'user',
      parts: [
        {
          type: 'tool-screenshot' as string,
          toolCallId: 'u-call',
          toolName: 'screenshot',
          state: 'result',
          input: {},
          output: {
            content: [
              { type: 'image', data: 'USER_IMG', mimeType: 'image/jpeg' },
            ],
          },
        } as unknown as UIMessage['parts'][number],
      ],
    }

    const messages: UIMessage[] = [
      userMsg,
      makeAssistantMessage([makeScreenshotPart('c1', 'R1')]),
      makeAssistantMessage([makeScreenshotPart('c2', 'R2')]),
      makeAssistantMessage([makeScreenshotPart('c3', 'R3')]),
      makeAssistantMessage([makeScreenshotPart('c4', 'R4')]),
    ]

    stripUIImageOutputs(messages, 'sess', store as never, 3)

    // user message at index 0 is never touched
    const uPart = userMsg.parts[0] as Record<string, unknown>
    const uContent = (uPart.output as Record<string, unknown>).content as Array<
      Record<string, unknown>
    >
    expect(uContent[0]?.data).toBe('USER_IMG')

    // Only the oldest assistant message (c1) is stripped
    expect(store.stored).toHaveLength(1)
    expect(store.stored[0]?.toolCallId).toBe('c1')
  })

  it('keepRecentN=0 strips all assistant messages', () => {
    const store = new MockImageStore()
    const messages: UIMessage[] = [
      makeUserMessage('u'),
      makeAssistantMessage([makeScreenshotPart('c1', 'OLD1')]),
      makeAssistantMessage([makeScreenshotPart('c2', 'OLD2')]),
      makeAssistantMessage([makeScreenshotPart('c3', 'OLD3')]),
    ]

    stripUIImageOutputs(messages, 'sess', store as never, 0)

    expect(store.stored).toHaveLength(3)
  })

  it('keepRecentN larger than total assistant messages → nothing stripped', () => {
    const store = new MockImageStore()
    const messages: UIMessage[] = [
      makeUserMessage('u'),
      makeAssistantMessage([makeScreenshotPart('c1', 'DATA')]),
      makeAssistantMessage([makeScreenshotPart('c2', 'DATA')]),
    ]

    stripUIImageOutputs(messages, 'sess', store as never, 10)

    expect(store.stored).toHaveLength(0)
    // Data is untouched
    const part1 = messages[1]?.parts[0] as Record<string, unknown>
    const c1 = (part1.output as Record<string, unknown>).content as Array<
      Record<string, unknown>
    >
    expect(c1[0]?.data).toBe('DATA')
  })

  it('messages with no image content are unaffected', () => {
    const store = new MockImageStore()
    const textOnlyPart = {
      type: 'tool-filesystem_read',
      toolCallId: 'c1',
      toolName: 'filesystem_read',
      state: 'result',
      input: { path: '/tmp/foo.ts' },
      output: {
        content: [{ type: 'text', text: 'const x = 1' }],
        isError: false,
      },
    } as unknown as UIMessage['parts'][number]

    const messages: UIMessage[] = [
      makeUserMessage('u1'),
      makeAssistantMessage([textOnlyPart]),
      makeUserMessage('u2'),
      makeAssistantMessage([makeScreenshotPart('c2', 'R1')]),
      makeUserMessage('u3'),
      makeAssistantMessage([makeScreenshotPart('c3', 'R2')]),
      makeUserMessage('u4'),
      makeAssistantMessage([makeScreenshotPart('c4', 'R3')]),
    ]

    stripUIImageOutputs(messages, 'sess', store as never, 3)

    // Text-only tool at index 1 is in strip range but has no images
    expect(store.stored).toHaveLength(0)
    const part = messages[1]?.parts[0] as Record<string, unknown>
    const content = (part.output as Record<string, unknown>).content as Array<
      Record<string, unknown>
    >
    expect(content[0]?.text).toBe('const x = 1')
  })
})

// ---------------------------------------------------------------------------
// sanitizeMessagesForToolset
// ---------------------------------------------------------------------------

describe('sanitizeMessagesForToolset', () => {
  const allTools = new Set([
    'navigate_page',
    'click',
    'take_snapshot',
    'filesystem_read',
    'filesystem_write',
    'evaluate_script',
  ])

  const noFilesystemTools = new Set([
    'navigate_page',
    'click',
    'take_snapshot',
    'evaluate_script',
  ])

  it('preserves messages with no tool parts', () => {
    const messages: UIMessage[] = [
      makeUserMessage('Hello'),
      makeAssistantMessage([{ type: 'text', text: 'Hi there!' }]),
    ]

    const result = sanitizeMessagesForToolset(messages, noFilesystemTools)
    expect(result).toHaveLength(2)
    expect(result[0].parts).toHaveLength(1)
    expect(result[1].parts).toHaveLength(1)
  })

  it('preserves tool parts when tool is in the toolset', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'text', text: 'Taking a snapshot...' },
        {
          type: 'tool-take_snapshot',
          toolCallId: 'call-1',
          toolName: 'take_snapshot',
          state: 'result',
          input: { page: 1 },
          output: { content: 'snapshot data' },
        } as unknown as UIMessage['parts'][number],
      ]),
    ]

    const result = sanitizeMessagesForToolset(messages, allTools)
    expect(result).toHaveLength(1)
    expect(result[0].parts).toHaveLength(2)
  })

  it('strips tool parts when tool is NOT in the toolset', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'text', text: 'Reading file...' },
        {
          type: 'tool-filesystem_read',
          toolCallId: 'call-1',
          toolName: 'filesystem_read',
          state: 'result',
          input: { path: '/tmp/test.txt' },
          output: { content: 'file data' },
        } as unknown as UIMessage['parts'][number],
      ]),
    ]

    const result = sanitizeMessagesForToolset(messages, noFilesystemTools)
    expect(result).toHaveLength(1)
    // Only the text part should remain
    expect(result[0].parts).toHaveLength(1)
    expect(result[0].parts[0].type).toBe('text')
  })

  it('strips multiple removed tool parts from same message', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'text', text: 'Working on files...' },
        {
          type: 'tool-filesystem_read',
          toolCallId: 'call-1',
          toolName: 'filesystem_read',
          state: 'result',
          input: { path: '/tmp/a.txt' },
          output: {},
        } as unknown as UIMessage['parts'][number],
        {
          type: 'tool-filesystem_write',
          toolCallId: 'call-2',
          toolName: 'filesystem_write',
          state: 'result',
          input: { path: '/tmp/b.txt', content: 'data' },
          output: {},
        } as unknown as UIMessage['parts'][number],
      ]),
    ]

    const result = sanitizeMessagesForToolset(messages, noFilesystemTools)
    expect(result).toHaveLength(1)
    expect(result[0].parts).toHaveLength(1)
    expect(result[0].parts[0].type).toBe('text')
  })

  it('keeps browser tool parts while removing filesystem tool parts', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        {
          type: 'tool-take_snapshot',
          toolCallId: 'call-1',
          toolName: 'take_snapshot',
          state: 'result',
          input: { page: 1 },
          output: {},
        } as unknown as UIMessage['parts'][number],
        {
          type: 'tool-filesystem_read',
          toolCallId: 'call-2',
          toolName: 'filesystem_read',
          state: 'result',
          input: { path: '/tmp/test.txt' },
          output: {},
        } as unknown as UIMessage['parts'][number],
      ]),
    ]

    const result = sanitizeMessagesForToolset(messages, noFilesystemTools)
    expect(result).toHaveLength(1)
    expect(result[0].parts).toHaveLength(1)
    expect((result[0].parts[0] as { type: string }).type).toBe(
      'tool-take_snapshot',
    )
  })

  it('removes messages that become empty after stripping', () => {
    const messages: UIMessage[] = [
      makeUserMessage('Read this file'),
      makeAssistantMessage([
        {
          type: 'tool-filesystem_read',
          toolCallId: 'call-1',
          toolName: 'filesystem_read',
          state: 'result',
          input: { path: '/tmp/test.txt' },
          output: {},
        } as unknown as UIMessage['parts'][number],
      ]),
    ]

    const result = sanitizeMessagesForToolset(messages, noFilesystemTools)
    // The assistant message had only a tool part — after stripping, it's empty
    // and should be filtered out by hasMessageContent
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
  })

  it('preserves non-tool part types (reasoning, step-start, file)', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'text', text: 'Let me think...' },
        {
          type: 'reasoning',
          reasoning: 'Analyzing the request',
        } as unknown as UIMessage['parts'][number],
        {
          type: 'step-start',
        } as unknown as UIMessage['parts'][number],
      ]),
    ]

    const result = sanitizeMessagesForToolset(messages, noFilesystemTools)
    expect(result).toHaveLength(1)
    expect(result[0].parts).toHaveLength(3)
  })

  it('returns same message references when no filtering needed', () => {
    const messages: UIMessage[] = [
      makeUserMessage('Hello'),
      makeAssistantMessage([{ type: 'text', text: 'Hi!' }]),
    ]

    const result = sanitizeMessagesForToolset(messages, noFilesystemTools)
    // Messages that don't need filtering should be the same reference
    expect(result[0]).toBe(messages[0])
    expect(result[1]).toBe(messages[1])
  })

  it('handles empty message array', () => {
    const result = sanitizeMessagesForToolset([], noFilesystemTools)
    expect(result).toHaveLength(0)
  })

  it('handles empty toolset (all tools removed)', () => {
    const messages: UIMessage[] = [
      makeAssistantMessage([
        { type: 'text', text: 'Working...' },
        {
          type: 'tool-navigate_page',
          toolCallId: 'call-1',
          toolName: 'navigate_page',
          state: 'result',
          input: {},
          output: {},
        } as unknown as UIMessage['parts'][number],
      ]),
    ]

    const result = sanitizeMessagesForToolset(messages, new Set())
    expect(result).toHaveLength(1)
    expect(result[0].parts).toHaveLength(1)
    expect(result[0].parts[0].type).toBe('text')
  })
})

// ---------------------------------------------------------------------------
// hasMessageContent (existing function, verify edge cases)
// ---------------------------------------------------------------------------

describe('hasMessageContent', () => {
  it('rejects messages with empty parts array', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [],
    }
    expect(hasMessageContent(msg)).toBe(false)
  })

  it('rejects messages with only whitespace text', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [{ type: 'text', text: '   \n  ' }],
    }
    expect(hasMessageContent(msg)).toBe(false)
  })

  it('accepts messages with non-text parts', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-click',
          toolCallId: 'call-1',
          toolName: 'click',
          state: 'result',
          input: {},
          output: {},
        } as unknown as UIMessage['parts'][number],
      ],
    }
    expect(hasMessageContent(msg)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Integration: stripUIImageOutputs + ToolImageStore (real SQLite)
// ---------------------------------------------------------------------------

describe('stripUIImageOutputs integration with ToolImageStore', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'browseros-integration-'))
    const { initializeDb } = require('../../src/lib/db')
    initializeDb({
      dbPath: join(tmpDir, 'test.db'),
      runMigrations: true,
    })
  })

  afterEach(() => {
    const { closeDb } = require('../../src/lib/db')
    closeDb()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('stores image blobs and makes them retrievable after stripping', () => {
    const { ToolImageStore } = require('../../src/agent/session-store')
    const imageStore = new ToolImageStore()

    const jpegData = Buffer.from('fake-jpeg-content').toString('base64')
    const pngData = Buffer.from('fake-png-content').toString('base64')

    const messages: UIMessage[] = [
      makeUserMessage('go to github'),
      // Old message with JPEG screenshot (should be stripped)
      makeAssistantMessage([makeScreenshotPart('call-screenshot', jpegData)]),
      makeUserMessage('and click login'),
      // Old message with PNG act screenshot (should be stripped)
      makeAssistantMessage([
        {
          type: 'tool-act',
          toolCallId: 'call-act',
          toolName: 'act',
          state: 'result',
          input: { kind: 'click', ref: 'e1' },
          output: {
            content: [
              { type: 'text', text: 'ok (click)' },
              { type: 'image', data: pngData, mimeType: 'image/png' },
            ],
            isError: false,
            structuredContent: { kind: 'click' },
          },
        } as unknown as UIMessage['parts'][number],
      ]),
      makeUserMessage('ok'),
      makeAssistantMessage([makeScreenshotPart('call-r1', 'RECENT1')]),
      makeUserMessage('ok2'),
      makeAssistantMessage([makeScreenshotPart('call-r2', 'RECENT2')]),
      makeUserMessage('ok3'),
      makeAssistantMessage([makeScreenshotPart('call-r3', 'RECENT3')]),
    ]

    stripUIImageOutputs(messages, 'integ-session', imageStore, 3)

    // Both old images are stored
    const screenshot = imageStore.get('call-screenshot')
    expect(screenshot).not.toBeNull()
    expect(screenshot?.mimeType).toBe('image/jpeg')
    // round-trip blob integrity
    expect(Buffer.from(screenshot!.data).toString('base64')).toBe(jpegData)

    const actImg = imageStore.get('call-act')
    expect(actImg).not.toBeNull()
    expect(actImg?.mimeType).toBe('image/png')
    expect(Buffer.from(actImg!.data).toString('base64')).toBe(pngData)

    // Recent images are NOT stored (kept inline)
    expect(imageStore.get('call-r1')).toBeNull()
    expect(imageStore.get('call-r2')).toBeNull()
    expect(imageStore.get('call-r3')).toBeNull()

    // Old parts have stripped:true and no data in messages
    const oldScreenshotPart = messages[1]?.parts[0] as Record<string, unknown>
    const oldContent = (oldScreenshotPart.output as Record<string, unknown>)
      .content as Array<Record<string, unknown>>
    expect(oldContent[0]?.stripped).toBe(true)
    expect(oldContent[0]?.data).toBeUndefined()
  })

  it('deleteForSession removes images when a session is deleted', () => {
    const { ToolImageStore } = require('../../src/agent/session-store')
    const imageStore = new ToolImageStore()

    imageStore.store('del-session', 'call-1', 'DATA1', 'image/png')
    imageStore.store('del-session', 'call-2', 'DATA2', 'image/png')
    imageStore.store('other-session', 'call-3', 'DATA3', 'image/png')

    imageStore.deleteForSession('del-session')

    expect(imageStore.get('call-1')).toBeNull()
    expect(imageStore.get('call-2')).toBeNull()
    expect(imageStore.get('call-3')).not.toBeNull()
  })
})
