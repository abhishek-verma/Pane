/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export interface SelectionClickInput {
  selected: Set<string>
  lastClickedId: string | null
  clickedId: string
  /** Ids in the visual order of the list the click happened in — range select is scoped to this list. */
  visibleIds: string[]
  shiftKey: boolean
}

export interface SelectionClickResult {
  selected: Set<string>
  lastClickedId: string
}

export function applySelectionClick({
  selected,
  lastClickedId,
  clickedId,
  visibleIds,
  shiftKey,
}: SelectionClickInput): SelectionClickResult {
  const next = new Set(selected)

  if (shiftKey && lastClickedId) {
    const anchorIndex = visibleIds.indexOf(lastClickedId)
    const targetIndex = visibleIds.indexOf(clickedId)
    if (anchorIndex !== -1 && targetIndex !== -1) {
      const [start, end] =
        anchorIndex <= targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex]
      for (let i = start; i <= end; i++) {
        next.add(visibleIds[i] as string)
      }
      return { selected: next, lastClickedId: clickedId }
    }
  }

  if (next.has(clickedId)) {
    next.delete(clickedId)
  } else {
    next.add(clickedId)
  }
  return { selected: next, lastClickedId: clickedId }
}
