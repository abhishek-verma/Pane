/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useState } from 'react'
import { applySelectionClick } from './context-selection.helpers'

export function useNodeSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastClickedId, setLastClickedId] = useState<string | null>(null)

  function click(clickedId: string, visibleIds: string[], shiftKey: boolean) {
    const result = applySelectionClick({
      selected,
      lastClickedId,
      clickedId,
      visibleIds,
      shiftKey,
    })
    setSelected(result.selected)
    setLastClickedId(result.lastClickedId)
  }

  function clear() {
    setSelected(new Set())
    setLastClickedId(null)
  }

  return { selected, click, clear }
}
