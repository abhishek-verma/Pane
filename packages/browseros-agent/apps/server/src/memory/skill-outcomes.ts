/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Track skills loaded during a run; finalize success_rate when the run ends.
 */

import { recordSkillOutcome } from './store'

const pendingByRun = new Map<string, Set<string>>()

export function noteSkillLoaded(runId: string, skillId: string): void {
  if (!runId || !skillId) return
  const set = pendingByRun.get(runId) ?? new Set<string>()
  set.add(skillId)
  pendingByRun.set(runId, set)
}

export function finalizeSkillOutcomesForRun(
  runId: string,
  success: boolean,
): void {
  const set = pendingByRun.get(runId)
  if (!set) return
  pendingByRun.delete(runId)
  for (const skillId of set) {
    recordSkillOutcome(skillId, success)
  }
}

/** Test helper — clear pending map between cases. */
export function clearPendingSkillOutcomes(): void {
  pendingByRun.clear()
}
