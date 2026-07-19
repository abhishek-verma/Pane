import type { ToolEvidence } from './types'

export type CoalescedSpecialized = {
  key: string
  evidence: ToolEvidence
  /** Number of consecutive same-path file edits merged into this card */
  editCount: number
}

/**
 * Collapse consecutive specialized file-change cards that share the same path
 * into one card. Browser (and other) specialized cards pass through unchanged.
 * Peek comes from the last edit; additions/deletions are summed when present.
 */
export function coalesceConsecutiveFileEdits(
  specialized: ToolEvidence[],
): CoalescedSpecialized[] {
  const groups: CoalescedSpecialized[] = []

  for (const evidence of specialized) {
    const path =
      evidence.kind === 'file-change' ? evidence.file?.path : undefined
    const last = groups[groups.length - 1]
    const lastPath =
      last?.evidence.kind === 'file-change'
        ? last.evidence.file?.path
        : undefined

    if (
      path &&
      last &&
      lastPath === path &&
      last.evidence.file &&
      evidence.file
    ) {
      const prev = last.evidence.file
      const next = evidence.file
      last.editCount += 1
      last.evidence = {
        ...evidence,
        file: {
          ...next,
          additions:
            prev.additions != null || next.additions != null
              ? (prev.additions ?? 0) + (next.additions ?? 0)
              : undefined,
          deletions:
            prev.deletions != null || next.deletions != null
              ? (prev.deletions ?? 0) + (next.deletions ?? 0)
              : undefined,
        },
      }
      last.key = evidence.toolCallId
      continue
    }

    groups.push({
      key: evidence.toolCallId,
      evidence,
      editCount: 1,
    })
  }

  return groups
}
