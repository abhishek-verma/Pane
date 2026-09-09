/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export function shouldShowFirstSkillMilestone(
  skillsLearned: number,
  baseline: number,
  alreadySeen: boolean,
): boolean {
  return baseline === 0 && skillsLearned >= 1 && !alreadySeen
}
