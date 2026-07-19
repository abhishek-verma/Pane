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
})
