/**
 * @license
 * Copyright 2025 Pane
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { CheckCircle2, Info, Mic } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ONBOARDING_STEP_COMPLETED_EVENT } from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import {
  useAsrModelStatus,
  useEnsureAsrModel,
} from '@/screens/capture/useCaptureApi'
import { type StepDirection, StepTransition } from './StepTransition'

export interface StepVoiceProps {
  direction: StepDirection
  onContinue: () => void
}

export const StepVoice = ({ direction, onContinue }: StepVoiceProps) => {
  const { isReady, loading: statusLoading } = useAsrModelStatus()
  const { state: downloadState, start: startDownload } = useEnsureAsrModel()

  // Auto-start download when the step mounts and the model isn't ready.
  // Do NOT auto-retry after a failed download — once `error` is set, only
  // the explicit "Retry download" button should call startDownload again,
  // otherwise this effect and the SSE onerror handler loop forever.
  useEffect(() => {
    if (
      !statusLoading &&
      !isReady &&
      !downloadState.inProgress &&
      !downloadState.error
    ) {
      startDownload()
    }
  }, [
    statusLoading,
    isReady,
    downloadState.inProgress,
    downloadState.error,
    startDownload,
  ])

  const finish = (downloaded: boolean) => {
    track(ONBOARDING_STEP_COMPLETED_EVENT, {
      step: 5,
      step_name: 'voice',
      granted: downloaded,
      skipped: !downloaded,
    })
    onContinue()
  }

  const isDownloading = downloadState.inProgress
  const isDone = isReady || downloadState.percent >= 100
  const hasError = Boolean(downloadState.error)

  return (
    <StepTransition direction={direction}>
      <div className="mx-auto w-full max-w-md space-y-6 px-6 py-10">
        <div className="space-y-2 text-center">
          <h2 className="font-bold text-2xl tracking-tight">Voice input</h2>
          <p className="text-muted-foreground text-sm">
            Pane transcribes your voice locally — nothing leaves your machine.
            This requires a one-time Whisper model download (~150 MB).
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex flex-col items-center gap-4">
            {isDone ? (
              <>
                <CheckCircle2 className="size-10 text-green-500" />
                <p className="font-medium text-sm">Model ready</p>
                <p className="text-center text-muted-foreground text-xs">
                  Tap the mic button in any chat input to dictate. Meeting
                  transcription is also ready.
                </p>
              </>
            ) : hasError ? (
              <>
                <Mic className="size-10 text-muted-foreground" />
                <p className="text-destructive text-sm">
                  {downloadState.error}
                </p>
                <Button size="sm" variant="outline" onClick={startDownload}>
                  Retry download
                </Button>
              </>
            ) : (
              <>
                <Mic className="size-10 text-[var(--accent-orange)]" />
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">
                      {isDownloading ? 'Downloading model…' : 'Checking…'}
                    </span>
                    {isDownloading && (
                      <span className="font-medium">
                        {downloadState.percent}%
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--accent-orange)] transition-all duration-300"
                      style={{ width: `${downloadState.percent}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {!isDone && !hasError && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-muted-foreground text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Voice dictation in chat and meeting transcription won't work until
              the model is downloaded. You can resume from{' '}
              <span className="font-medium text-foreground">
                Settings → Permissions
              </span>
              .
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {isDone ? (
            <Button
              className="w-full bg-[var(--accent-orange)] text-primary-foreground hover:bg-[var(--accent-orange)]/90"
              onClick={() => finish(true)}
            >
              Continue
            </Button>
          ) : (
            <>
              {hasError ? null : (
                <Button
                  className="w-full bg-[var(--accent-orange)] text-primary-foreground hover:bg-[var(--accent-orange)]/90"
                  onClick={() => finish(false)}
                >
                  Download in background
                </Button>
              )}
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => {
                  // Cancel the in-progress download if user explicitly skips
                  finish(false)
                }}
              >
                Skip
              </Button>
            </>
          )}
        </div>
      </div>
    </StepTransition>
  )
}
