import { describe, expect, test } from 'bun:test'
import type { UIMessage } from 'ai'
import { getMessageSegments } from './getMessageSegments'

function assistantMessage(parts: UIMessage['parts'], id = 'msg-1'): UIMessage {
  return { id, role: 'assistant', parts }
}

describe('getMessageSegments', () => {
  test('skips duplicate resume reasoning and keeps one tool batch', () => {
    const reasoning =
      'The user wants me to create a new text file named test 2 with content abc.'
    const message = assistantMessage([
      { type: 'reasoning', text: reasoning },
      {
        type: 'tool-filesystem_write',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: { path: 'test 2', content: 'abc' },
        approval: { id: 'approval-1' },
      },
      { type: 'reasoning', text: reasoning },
      {
        type: 'tool-filesystem_write',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { path: 'test 2', content: 'abc' },
        output: [{ type: 'text', text: 'ok' }],
        approval: { id: 'approval-1', approved: true },
      },
    ])

    const segments = getMessageSegments(message, true, false)

    expect(segments.filter((s) => s.type === 'reasoning')).toHaveLength(1)
    expect(segments.filter((s) => s.type === 'tool-batch')).toHaveLength(1)
    const batch = segments.find((s) => s.type === 'tool-batch')
    expect(batch?.type === 'tool-batch' && batch.tools).toHaveLength(1)
    if (batch?.type === 'tool-batch') {
      expect(batch.tools[0]?.state).toBe('output-available')
    }
  })

  test('emits pi-preview from pi_open tool output and autoOpen', () => {
    const message = assistantMessage([
      {
        type: 'tool-pi_open',
        toolCallId: 'call-pi',
        state: 'output-available',
        input: { href: 'pi://sites/s1' },
        output: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'pi_page',
                href: 'pi://sites/s1',
                navigate: true,
                preview: { title: 'Job Search', kind: 'site' },
              }),
            },
          ],
        },
      },
    ])

    const segments = getMessageSegments(message, true, false)
    const cards = segments.filter((s) => s.type === 'pi-preview')
    expect(cards).toHaveLength(1)
    if (cards[0]?.type === 'pi-preview') {
      expect(cards[0].href).toBe('pi://sites/s1')
      expect(cards[0].autoOpen).toBe(true)
      expect(cards[0].preview?.title).toBe('Job Search')
    }
    expect(segments.filter((s) => s.type === 'tool-batch')).toHaveLength(0)
  })

  test('upgrades an earlier non-autoOpen card when a later pi_open targets the same href', () => {
    // pi_page_create's own output is also a PI_CARD_TOOLS entry and creates
    // a card with autoOpen=false; a follow-up pi_open for that same page
    // must upgrade it to autoOpen=true rather than being dropped as a
    // duplicate href, or the page never auto-navigates despite the agent
    // explicitly calling pi_open.
    const message = assistantMessage([
      {
        type: 'tool-pi_page_create',
        toolCallId: 'call-create',
        state: 'output-available',
        input: { title: 'Report' },
        output: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                pageId: 'temp_2',
                route: '#/pi/temp/temp_2',
                href: 'pi://temp/temp_2',
              }),
            },
          ],
        },
      },
      {
        type: 'tool-pi_open',
        toolCallId: 'call-open',
        state: 'output-available',
        input: { href: 'pi://temp/temp_2' },
        output: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'pi_page',
                href: 'pi://temp/temp_2',
                navigate: true,
                preview: { title: 'Report', kind: 'temp' },
              }),
            },
          ],
        },
      },
    ])

    const segments = getMessageSegments(message, true, false)
    const cards = segments.filter((s) => s.type === 'pi-preview')
    expect(cards).toHaveLength(1)
    if (cards[0]?.type === 'pi-preview') {
      expect(cards[0].autoOpen).toBe(true)
      expect(cards[0].preview?.title).toBe('Report')
    }
  })

  test('emits pi-preview from an ACP-namespaced pi_open tool call (mcp__browseros__ prefix)', () => {
    // Reproduces the ACP-provider bug: Claude Code (and other ACP hosts)
    // report BrowserOS MCP tools as `mcp__browseros__<name>`, not the bare
    // name the in-process tool loop uses. Before the bareToolName() fix,
    // this never matched PI_CARD_TOOLS, so pi_open succeeded but no card
    // (and no auto-navigate) ever appeared — the user had to dig the href
    // out of the raw tool call themselves.
    const message = assistantMessage([
      {
        type: 'tool-mcp__browseros__pi_page_create',
        toolCallId: 'call-create',
        state: 'output-available',
        input: { title: 'AI Browser Comparison 2026' },
        output: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                pageId: 'temp_1',
                route: '#/pi/temp/temp_1',
                href: 'pi://temp/temp_1',
              }),
            },
          ],
        },
      },
      {
        type: 'tool-mcp__browseros__pi_open',
        toolCallId: 'call-open',
        state: 'output-available',
        input: { href: 'pi://temp/temp_1' },
        output: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                type: 'pi_page',
                href: 'pi://temp/temp_1',
                navigate: true,
                preview: { title: 'AI Browser Comparison 2026', kind: 'temp' },
              }),
            },
          ],
        },
      },
    ])

    const segments = getMessageSegments(message, true, false)
    const cards = segments.filter((s) => s.type === 'pi-preview')
    expect(cards).toHaveLength(1)
    if (cards[0]?.type === 'pi-preview') {
      expect(cards[0].href).toBe('pi://temp/temp_1')
      expect(cards[0].autoOpen).toBe(true)
    }
    // Neither call should fall through to a generic collapsed tool row.
    expect(segments.filter((s) => s.type === 'tool-batch')).toHaveLength(0)
  })

  test('splits pi:// links out of assistant text', () => {
    const message = assistantMessage([
      {
        type: 'text',
        text: 'Ready at pi://sites/abc/pages/p1 for you.',
      },
    ])
    const segments = getMessageSegments(message, true, false)
    expect(segments.some((s) => s.type === 'pi-preview')).toBe(true)
    const card = segments.find((s) => s.type === 'pi-preview')
    if (card?.type === 'pi-preview') {
      expect(card.href).toBe('pi://sites/abc/pages/p1')
    }
  })

  test('does not swallow a trailing markdown code-tick into the href', () => {
    const message = assistantMessage([
      {
        type: 'text',
        text: 'Open it here: `pi://sites/s1/entities/metafore-ai` and go.',
      },
    ])
    const segments = getMessageSegments(message, true, false)
    const card = segments.find((s) => s.type === 'pi-preview')
    if (card?.type === 'pi-preview') {
      expect(card.href).toBe('pi://sites/s1/entities/metafore-ai')
    } else {
      throw new Error('expected a pi-preview segment')
    }
  })
})
