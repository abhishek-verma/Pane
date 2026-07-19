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

  test('browser act still specialized', () => {
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
})
