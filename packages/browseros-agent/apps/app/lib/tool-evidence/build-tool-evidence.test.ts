import { describe, expect, test } from 'bun:test'
import { buildToolEvidence } from './build-tool-evidence'

describe('buildToolEvidence', () => {
  test('file edit completed → specialized file card', () => {
    const e = buildToolEvidence({
      toolCallId: 'c1',
      toolName: 'filesystem_edit',
      state: 'output-available',
      input: {
        path: 'a.ts',
        old_string: 'x',
        new_string: 'y',
      },
      output: {
        content: [{ type: 'text', text: 'Applied edit to a.ts\n\n- x\n+ y' }],
      },
    })
    expect(e.specialized).toBe(true)
    expect(e.kind).toBe('file-change')
    expect(e.file?.path).toBe('a.ts')
  })

  test('ACP-namespaced tool name (mcp__browseros__ prefix) still classifies as a file-change card', () => {
    const e = buildToolEvidence({
      toolCallId: 'c1b',
      toolName: 'mcp__browseros__filesystem_edit',
      state: 'output-available',
      input: {
        path: 'a.ts',
        old_string: 'x',
        new_string: 'y',
      },
      output: {
        content: [{ type: 'text', text: 'Applied edit to a.ts\n\n- x\n+ y' }],
      },
    })
    expect(e.specialized).toBe(true)
    expect(e.kind).toBe('file-change')
    expect(e.file?.path).toBe('a.ts')
  })

  test('approval-requested → not specialized preview', () => {
    const e = buildToolEvidence({
      toolCallId: 'c2',
      toolName: 'filesystem_write',
      state: 'approval-requested',
      input: { path: 'a', content: 'b' },
      output: null,
    })
    expect(e.state).toBe('approval')
    expect(e.specialized).toBe(false)
  })

  test('snapshot → generic collapsed', () => {
    const e = buildToolEvidence({
      toolCallId: 'c3',
      toolName: 'snapshot',
      state: 'output-available',
      input: { page: 1 },
      output: { content: [{ type: 'text', text: 'big tree' }] },
    })
    expect(e.specialized).toBe(false)
    expect(e.generic?.title).toBeTruthy()
  })

  test('details unavailable path', () => {
    const e = buildToolEvidence({
      toolCallId: 'c4',
      toolName: 'act',
      state: 'completed',
      input: {},
      output: null,
      label: 'Clicked',
      subject: 'Submit',
      detailsUnavailable: true,
    })
    expect(e.specialized).toBe(true)
    expect(e.browser?.caption).toContain('Clicked')
    // Orchestrator stamps unavailable into pageDiffSummary when media is empty.
    expect(
      e.generic?.detailsUnavailable ||
        e.browser?.pageDiffSummary === 'Details unavailable for this run' ||
        e.browser?.pageDiffSummary == null,
    ).toBeTruthy()
  })

  test('filesystem_bash → specialized terminal card', () => {
    const e = buildToolEvidence({
      toolCallId: 'c5',
      toolName: 'filesystem_bash',
      state: 'output-available',
      input: { command: 'npm test' },
      output: {
        content: [{ type: 'text', text: 'PASS lib/foo.test.ts\n' }],
      },
    })
    expect(e.kind).toBe('terminal')
    expect(e.specialized).toBe(true)
    expect(e.terminal?.command).toBe('npm test')
    expect(e.terminal?.exitCode).toBe(0)
    expect(e.title).toBe('$ npm test')
  })

  test('filesystem_bash non-zero exit → error terminal card', () => {
    const e = buildToolEvidence({
      toolCallId: 'c6',
      toolName: 'filesystem_bash',
      state: 'output-available',
      input: { command: 'false' },
      output: {
        content: [{ type: 'text', text: 'boom\n\n[Exit code: 1]' }],
        isError: true,
      },
    })
    expect(e.kind).toBe('terminal')
    expect(e.state).toBe('error')
    expect(e.terminal?.exitCode).toBe(1)
    expect(e.terminal?.stdout).toBe('boom')
  })

  test('execute_action → specialized app-send card', () => {
    const e = buildToolEvidence({
      toolCallId: 'c7',
      toolName: 'execute_action',
      state: 'output-available',
      input: {
        server_name: 'slack',
        action_name: 'chat_postMessage',
        channel: '#eng',
      },
      output: {
        content: [{ type: 'text', text: '{"ok":true,"ts":"1.2"}' }],
      },
    })
    expect(e.kind).toBe('app-send')
    expect(e.specialized).toBe(true)
    expect(e.appSend?.title).toContain('slack')
    expect(e.appSend?.destination).toBe('#eng')
  })

  test('browser act still specialized (not app-send)', () => {
    const e = buildToolEvidence({
      toolCallId: 'c8',
      toolName: 'act',
      state: 'output-available',
      input: { kind: 'click', ref: 'e12' },
      output: { content: [{ type: 'text', text: 'ok (click)' }] },
    })
    expect(e.kind).toBe('browser-action')
    expect(e.specialized).toBe(true)
    expect(e.browser).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // Stripped image tests (new behaviour)
  // -------------------------------------------------------------------------

  test('screenshot with inline image populates browser.media', () => {
    const e = buildToolEvidence({
      toolCallId: 'c9',
      toolName: 'screenshot',
      state: 'output-available',
      input: { page: 1, format: 'jpeg' },
      output: {
        content: [
          { type: 'image', data: 'BASE64JPEG', mimeType: 'image/jpeg' },
        ],
        isError: false,
        structuredContent: { page: 1, format: 'jpeg', bytes: 1000 },
      },
    })
    expect(e.kind).toBe('screenshot')
    expect(e.specialized).toBe(true)
    expect(e.browser?.media).toHaveLength(1)
    expect(e.browser?.media[0]?.data).toBe('BASE64JPEG')
    expect(e.browser?.strippedImages).toBeUndefined()
  })

  test('screenshot with stripped image populates browser.strippedImages not media', () => {
    const e = buildToolEvidence({
      toolCallId: 'c10',
      toolName: 'screenshot',
      state: 'output-available',
      input: { page: 1, format: 'jpeg' },
      output: {
        content: [{ type: 'image', mimeType: 'image/jpeg', stripped: true }],
        isError: false,
        structuredContent: { page: 1, format: 'jpeg', bytes: 1000 },
      },
    })
    expect(e.kind).toBe('screenshot')
    expect(e.browser?.media).toHaveLength(0)
    expect(e.browser?.strippedImages).toHaveLength(1)
    expect(e.browser?.strippedImages?.[0]).toEqual({
      stripped: true,
      mimeType: 'image/jpeg',
    })
  })

  test('act tool with stripped PNG populates strippedImages', () => {
    const e = buildToolEvidence({
      toolCallId: 'c11',
      toolName: 'act',
      state: 'output-available',
      input: { kind: 'click', ref: 'e12' },
      output: {
        content: [
          {
            type: 'text',
            text: 'ok (click)\n--- Additional context ---\n[Page 1 screenshot]',
          },
          { type: 'image', mimeType: 'image/png', stripped: true },
        ],
        isError: false,
        structuredContent: { kind: 'click', afterUrl: 'https://example.com' },
      },
    })
    expect(e.kind).toBe('browser-action')
    expect(e.browser?.media).toHaveLength(0)
    expect(e.browser?.strippedImages).toHaveLength(1)
    expect(e.browser?.strippedImages?.[0]?.mimeType).toBe('image/png')
    expect(e.browser?.url).toBe('https://example.com')
  })

  test('navigate tool with stripped image carries hostname and strippedImages', () => {
    const e = buildToolEvidence({
      toolCallId: 'c12',
      toolName: 'navigate',
      state: 'output-available',
      input: { url: 'https://github.com', page: 1 },
      output: {
        content: [
          { type: 'text', text: 'Navigated to github.com' },
          { type: 'image', mimeType: 'image/png', stripped: true },
        ],
        isError: false,
        structuredContent: { afterUrl: 'https://github.com' },
      },
    })
    expect(e.kind).toBe('browser-action')
    expect(e.browser?.strippedImages).toHaveLength(1)
    expect(e.browser?.hostname).toBe('github.com')
  })
})
