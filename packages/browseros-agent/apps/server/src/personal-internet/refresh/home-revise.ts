/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Kind D / home continuity revise — local merge (no LLM required for ship).
 */

import { buildPiHomeProjection } from '../home-projection'
import { clearDismissedContinuity, writeHomeContinuity } from '../store'
import type { PiContinuityBlock } from '../types'

/** Rebuild Today continuity from approvals + doorway urgencies; persist. */
export async function reviseHomeContinuityLocal(): Promise<{
  blocks: PiContinuityBlock[]
}> {
  // Projection merges live approvals at read time. Never persist approval-*
  // cards — after server restart / expiry they become Approve/Deny ghosts
  // with tokens that resolve nothing useful for the dead run.
  const projection = await buildPiHomeProjection()
  const blocks = projection.continuity
    .filter((b) => !b.id.startsWith('approval-'))
    .slice(0, 5)
  await writeHomeContinuity(blocks)
  return { blocks }
}

/** Manual Today refresh: clear removals, then rebuild from current urgencies. */
export async function refreshHomeToday(): Promise<{
  blocks: PiContinuityBlock[]
}> {
  await clearDismissedContinuity()
  return reviseHomeContinuityLocal()
}
