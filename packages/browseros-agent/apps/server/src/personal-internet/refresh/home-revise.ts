/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Kind D / home continuity revise — local merge (no LLM required for ship).
 */

import {
  continuityFromApprovals,
  mergeContinuityBlocks,
} from '../continuity-sources'
import { buildPiHomeProjection } from '../home-projection'
import { writeHomeContinuity } from '../store'
import type { PiContinuityBlock } from '../types'

/** Rebuild Today continuity from approvals + doorway urgencies; persist. */
export async function reviseHomeContinuityLocal(): Promise<{
  blocks: PiContinuityBlock[]
}> {
  const projection = await buildPiHomeProjection()
  // buildPiHomeProjection already merges approvals when wired; persist snapshot.
  const fromApprovals = continuityFromApprovals()
  const blocks = mergeContinuityBlocks(projection.continuity, fromApprovals, 5)
  await writeHomeContinuity(blocks)
  return { blocks }
}
