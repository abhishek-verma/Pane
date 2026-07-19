import { describe, expect, test } from 'bun:test'
import { buildFileChangeDetail } from './file-evidence'

describe('buildFileChangeDetail', () => {
  test('parses filesystem_edit diff from output text', () => {
    const detail = buildFileChangeDetail({
      toolName: 'filesystem_edit',
      input: {
        path: 'README.md',
        old_string: 'browswer',
        new_string: 'browser',
      },
      outputText: 'Applied edit to README.md\n\n- browswer\n+ browser',
      isError: false,
    })
    expect(detail?.path).toBe('README.md')
    expect(detail?.kind).toBe('edit')
    expect(detail?.additions).toBe(1)
    expect(detail?.deletions).toBe(1)
    expect(detail?.diffLines).toEqual(['- browswer', '+ browser'])
  })

  test('create preview from write input.content', () => {
    const detail = buildFileChangeDetail({
      toolName: 'filesystem_write',
      input: { path: 'notes.txt', content: 'hello\nworld' },
      outputText: 'Wrote 11 bytes to notes.txt',
      isError: false,
    })
    expect(detail?.kind).toBe('create')
    expect(detail?.bytesWritten).toBe(11)
    expect(detail?.diffLines[0]).toBe('+ hello')
    expect(detail?.diffLines[1]).toBe('+ world')
  })

  test('huge write → stats only', () => {
    const content = 'x'.repeat(250_000)
    const detail = buildFileChangeDetail({
      toolName: 'filesystem_write',
      input: { path: 'big.bin', content },
      outputText: `Wrote ${content.length} bytes to big.bin`,
      isError: false,
    })
    expect(detail?.omitFullContent).toBe(true)
    expect(detail?.diffLines).toEqual([])
  })

  test('error → null detail (caller uses error card)', () => {
    expect(
      buildFileChangeDetail({
        toolName: 'filesystem_edit',
        input: { path: 'a.ts', old_string: 'a', new_string: 'b' },
        outputText: 'old_string not found',
        isError: true,
      }),
    ).toBeNull()
  })
})
