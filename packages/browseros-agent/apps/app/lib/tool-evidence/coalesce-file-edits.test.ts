import { describe, expect, test } from 'bun:test'
import { coalesceConsecutiveFileEdits } from './coalesce-file-edits'
import type { ToolEvidence } from './types'

function fileEvidence(
  id: string,
  path: string,
  additions = 1,
  deletions = 0,
): ToolEvidence {
  return {
    toolCallId: id,
    toolName: 'filesystem_edit',
    kind: 'file-change',
    state: 'completed',
    specialized: true,
    title: path,
    file: {
      path,
      kind: 'edit',
      additions,
      deletions,
      diffLines: [`+ line from ${id}`],
    },
  }
}

function browserEvidence(id: string): ToolEvidence {
  return {
    toolCallId: id,
    toolName: 'act',
    kind: 'browser-action',
    state: 'completed',
    specialized: true,
    title: 'Clicked',
    browser: { caption: 'Clicked', media: [] },
  }
}

describe('coalesceConsecutiveFileEdits', () => {
  test('merges consecutive same-path file edits', () => {
    const groups = coalesceConsecutiveFileEdits([
      fileEvidence('a', 'src/a.ts', 1, 1),
      fileEvidence('b', 'src/a.ts', 2, 0),
      fileEvidence('c', 'src/b.ts', 1, 0),
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]?.editCount).toBe(2)
    expect(groups[0]?.evidence.file?.path).toBe('src/a.ts')
    expect(groups[0]?.evidence.file?.additions).toBe(3)
    expect(groups[0]?.evidence.file?.deletions).toBe(1)
    expect(groups[0]?.evidence.file?.diffLines).toEqual(['+ line from b'])
    expect(groups[1]?.editCount).toBe(1)
    expect(groups[1]?.evidence.file?.path).toBe('src/b.ts')
  })

  test('does not merge when interrupted by a browser card', () => {
    const groups = coalesceConsecutiveFileEdits([
      fileEvidence('a', 'src/a.ts'),
      browserEvidence('nav'),
      fileEvidence('b', 'src/a.ts'),
    ])

    expect(groups).toHaveLength(3)
    expect(groups[0]?.editCount).toBe(1)
    expect(groups[1]?.evidence.kind).toBe('browser-action')
    expect(groups[2]?.editCount).toBe(1)
  })
})
