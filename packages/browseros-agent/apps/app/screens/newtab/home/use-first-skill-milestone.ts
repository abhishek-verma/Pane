/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useState } from 'react'

const MILESTONE_KEY = 'pane_home_first_skill_milestone_seen'

export function shouldShowFirstSkillMilestone(
  skillsLearned: number,
  alreadySeen: boolean,
): boolean {
  return skillsLearned >= 1 && !alreadySeen
}

export function useFirstSkillMilestone(skillsLearned: number | undefined): {
  show: boolean
  dismiss: () => void
} {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (skillsLearned == null || skillsLearned < 1) return
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    let cancelled = false
    chrome.storage.local.get(MILESTONE_KEY).then((result) => {
      if (cancelled) return
      const alreadySeen = Boolean(result[MILESTONE_KEY])
      setShow(shouldShowFirstSkillMilestone(skillsLearned, alreadySeen))
    })
    return () => {
      cancelled = true
    }
  }, [skillsLearned])

  const dismiss = () => {
    setShow(false)
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    void chrome.storage.local.set({ [MILESTONE_KEY]: true })
  }

  return { show, dismiss }
}
