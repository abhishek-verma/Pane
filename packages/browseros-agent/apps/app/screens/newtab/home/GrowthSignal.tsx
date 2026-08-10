/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import type { HomeGrowth } from '@/screens/newtab/home/home-data'
import { PiSectionLabel } from '@/screens/personal-internet/PiChrome'

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export const GrowthSignal: FC<{ growth?: HomeGrowth }> = ({ growth }) => {
  if (!growth) return null
  const hasGrowth =
    growth.skillsLearned > 0 ||
    growth.memoriesCount > 0 ||
    growth.sitesActive > 0

  return (
    <section className="border-border border-t py-3">
      <PiSectionLabel>Growing</PiSectionLabel>
      {hasGrowth ? (
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          {plural(growth.skillsLearned, 'skill')} learned ·{' '}
          {plural(growth.memoriesCount, 'thing')} remembered
          {growth.sitesActive > 0
            ? ` · ${plural(growth.sitesActive, 'site')} updating on their own`
            : ''}
        </p>
      ) : (
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          Pane is just getting to know you. Use it for real work and it starts
          remembering context, learning what you do, and updating things on its
          own — check back in a few days.
        </p>
      )}
    </section>
  )
}
