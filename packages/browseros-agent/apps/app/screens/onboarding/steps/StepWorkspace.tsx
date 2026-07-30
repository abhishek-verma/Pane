/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { FolderPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBrowserOSAdapter } from '@/lib/browseros/adapter'
import { ONBOARDING_STEP_COMPLETED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import type { WorkspaceFolder } from '@/lib/workspace/workspace-storage'
import { useWorkspace } from '@/modules/workspace/workspace.hooks'
import { type StepDirection, StepTransition } from './StepTransition'

export interface StepWorkspaceProps {
  direction: StepDirection
  onContinue: () => void
}

export const StepWorkspace = ({
  direction,
  onContinue,
}: StepWorkspaceProps) => {
  const { selectedFolder, addFolder } = useWorkspace()

  const finish = (granted: boolean) => {
    track(ONBOARDING_STEP_COMPLETED_EVENT, {
      step: 4,
      step_name: 'workspace',
      granted,
      skipped: !granted,
    })
    onContinue()
  }

  const handleChooseFolder = async () => {
    try {
      const adapter = getBrowserOSAdapter()
      const result = await adapter.choosePath({ type: 'folder' })
      if (!result) return

      const folder: WorkspaceFolder = {
        id: crypto.randomUUID(),
        name: result.name,
        path: result.path,
        addedAt: Date.now(),
      }
      await addFolder(folder)
    } catch {
      // User cancelled or API unavailable
    }
  }

  return (
    <StepTransition direction={direction}>
      <div className="mx-auto w-full max-w-md space-y-6 px-6 py-10">
        <div className="space-y-2 text-center">
          <h2 className="font-bold text-2xl tracking-tight">
            Pick a workspace folder
          </h2>
          <p className="text-muted-foreground text-sm">
            Optional. Give Pane a project folder so agents can read and edit
            files there. You can change this anytime.
          </p>
        </div>

        {selectedFolder ? (
          <div className="rounded-lg border border-[var(--accent-orange)]/40 bg-[var(--accent-orange)]/5 px-4 py-3 text-sm">
            <div className="font-medium">{selectedFolder.name}</div>
            <div className="mt-1 break-all text-muted-foreground text-xs">
              {selectedFolder.path}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void handleChooseFolder()}
            className="flex w-full flex-col items-center gap-3 rounded-lg border border-border border-dashed bg-card px-6 py-10 text-center transition-colors hover:border-[var(--accent-orange)]/50"
          >
            <FolderPlus className="size-8 text-muted-foreground" />
            <div className="font-medium text-sm">Choose a folder</div>
            <div className="text-muted-foreground text-xs">
              Repo, notes vault, or whatever you work in most
            </div>
          </button>
        )}

        <div className="flex flex-col gap-2">
          {selectedFolder ? (
            <Button
              className="w-full bg-[var(--accent-orange)] text-primary-foreground hover:bg-[var(--accent-orange)]/90"
              onClick={() => finish(true)}
            >
              Continue
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => finish(Boolean(selectedFolder))}
          >
            Skip for now
          </Button>
        </div>
      </div>
    </StepTransition>
  )
}
