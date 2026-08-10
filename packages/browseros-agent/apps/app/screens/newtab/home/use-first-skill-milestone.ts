/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useEffect, useState } from 'react'

const MILESTONE_KEY = 'pane_home_first_skill_milestone_seen'
// The skillsLearned count observed the very first time this code ever ran
// for this profile — lets us tell "just crossed 0 -> 1" apart from "already
// had skills before this feature shipped" without a server round trip.
const BASELINE_KEY = 'pane_home_first_skill_milestone_baseline'

export function shouldShowFirstSkillMilestone(
  skillsLearned: number,
  baseline: number,
  alreadySeen: boolean,
): boolean {
  return baseline === 0 && skillsLearned >= 1 && !alreadySeen
}

export function useFirstSkillMilestone(skillsLearned: number | undefined): {
  show: boolean
  dismiss: () => void
} {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (skillsLearned == null) return
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return
    let cancelled = false
    chrome.storage.local.get([MILESTONE_KEY, BASELINE_KEY]).then((result) => {
      if (cancelled) return
      const alreadySeen = Boolean(result[MILESTONE_KEY])
      const storedBaseline = result[BASELINE_KEY]
      if (typeof storedBaseline !== 'number') {
        // First observation ever for this profile — record it as the
        // baseline but never show on this same pass, since we can't tell
        // whether any existing skills were "just" learned.
        void chrome.storage.local.set({ [BASELINE_KEY]: skillsLearned })
        return
      }
      setShow(
        shouldShowFirstSkillMilestone(
          skillsLearned,
          storedBaseline,
          alreadySeen,
        ),
      )
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
