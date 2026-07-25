/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { Button } from '@/components/ui/button'

/** Shown in the side panel when product onboarding is incomplete. */
export const FinishOnboardingPanel: FC = () => {
  const openOnboarding = () => {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('app.html#/onboarding'),
    })
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="space-y-2">
        <h2 className="font-semibold text-lg">Finish setting up Pane</h2>
        <p className="text-muted-foreground text-sm">
          Add your name, a model, and how Pane should sound before chatting.
        </p>
      </div>
      <Button
        className="bg-[var(--accent-orange)] text-white hover:bg-[var(--accent-orange)]/90"
        onClick={openOnboarding}
      >
        Open setup
      </Button>
    </div>
  )
}
