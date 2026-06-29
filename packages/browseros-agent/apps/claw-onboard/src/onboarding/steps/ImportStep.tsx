import { AlertTriangle, ArrowRight, Download, RefreshCw } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import type { BrowserOSOnboardingState } from '../browseros-onboarding-api'
import { ChromeQuitNotice } from '../components/ChromeQuitNotice'
import { DisplayHeading, Em, StepCopy } from '../components/DisplayHeading'
import { ImportedSummaryCard } from '../components/ImportedSummaryCard'
import { ImportingProgressCard } from '../components/ImportingProgressCard'
import { ImportSourceTile } from '../components/ImportSourceTile'
import { MacKeychainNotice } from '../components/MacKeychainNotice'
import { StepWrap } from '../components/StepWrap'
import {
  completedImportItemCount,
  importItemLabel,
  importItemListLabel,
  importProgressTotal,
  selectableItemsForSource,
  selectedSourceById,
} from '../onboarding-v2.helpers'
import type { OnboardingFormValues } from '../onboarding-v2.schemas'
import type { ImportPhase } from '../onboarding-v2.types'

interface ImportStepProps {
  phase: ImportPhase
  state: BrowserOSOnboardingState
  form: UseFormReturn<OnboardingFormValues>
  onQuitChrome: () => void
  onImport: () => void
  onRefresh: () => void
  onContinue: () => void
}

/** Renders the browser import step across quit, picker, progress, and success states. */
export function ImportStep({
  phase,
  state,
  form,
  onQuitChrome,
  onImport,
  onRefresh,
  onContinue,
}: ImportStepProps) {
  const selectedSourceId = form.watch('selectedSourceId')
  const selectedSource = selectedSourceById(state.sources, selectedSourceId)
  const selectedItems = selectedSource
    ? selectableItemsForSource(selectedSource)
    : []
  const sourceName =
    selectedSource?.profileName || selectedSource?.browserName || 'source'
  const isDetecting = state.status === 'detecting'
  const hasSelectableItems = selectedItems.length > 0
  const isPickerValid =
    Boolean(selectedSource) && hasSelectableItems && !isDetecting
  const completedItems = completedImportItemCount(state.progress)
  const totalItems = selectedSource
    ? importProgressTotal(selectedSource, state.progress)
    : (state.progress?.totalItems ?? 0)
  const currentItemLabel = state.progress?.currentItem
    ? importItemLabel(state.progress.currentItem)
    : undefined
  const importedItems = state.progress?.completedItems ?? []
  const importedItemSummary = state.progress
    ? importedItems.length
      ? importItemListLabel(importedItems)
      : 'No completed items reported'
    : 'No item details reported'

  return (
    <StepWrap>
      <DisplayHeading>
        Import your <Em>logins</Em>.
      </DisplayHeading>
      <StepCopy>
        Pane copies your saved Chrome sessions so the agent never has to log in
        again. Sessions stay in a local vault on this Mac.
      </StepCopy>

      {phase === 'pre-quit' && <ChromeQuitNotice onQuitChrome={onQuitChrome} />}

      {phase === 'picker' && (
        <>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div className="font-bold text-[12.5px] text-ink-2">
              {isDetecting
                ? 'Detecting import sources'
                : 'Choose a browser profile to import'}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              disabled={isDetecting}
            >
              <RefreshCw
                className={`size-3.5 ${isDetecting ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
          <FormField
            control={form.control}
            name="selectedSourceId"
            render={({ field }) => (
              <FormItem
                className="mb-4 flex flex-col gap-2.5"
                role="radiogroup"
              >
                {state.sources.map((source) => (
                  <ImportSourceTile
                    key={source.id}
                    source={source}
                    selected={field.value === source.id}
                    onSelect={() => field.onChange(source.id)}
                  />
                ))}
                {!isDetecting && state.sources.length === 0 && (
                  <div className="rounded-xl border border-border-2 bg-card p-4 text-[12.5px] text-ink-2">
                    No import sources detected.
                  </div>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          {state.error && (
            <div className="mb-4 rounded-xl border border-amber/30 bg-amber-tint p-4 text-[12.5px] text-ink-2">
              {state.error.message}
            </div>
          )}
          <MacKeychainNotice />
          <Button
            type="button"
            size="lg"
            onClick={onImport}
            disabled={!isPickerValid}
          >
            <Download className="size-4" />
            {selectedSource && hasSelectableItems
              ? `Import ${selectedItems.length} items from ${sourceName}`
              : selectedSource
                ? 'No supported import items'
                : 'Pick an import source'}
          </Button>
        </>
      )}

      {phase === 'importing' && (
        <ImportingProgressCard
          currentItemLabel={currentItemLabel}
          progress={completedItems}
          total={totalItems}
        />
      )}

      {phase === 'failed' && (
        <>
          <div className="mb-4 rounded-xl border border-amber/30 bg-amber-tint p-4">
            <div className="mb-2 flex items-center gap-2 font-bold text-[13px] text-ink-1">
              <AlertTriangle className="size-4 text-amber" />
              Import failed
            </div>
            <div className="text-[12.5px] text-ink-2">
              {state.error?.message ??
                'Pane could not finish importing this profile.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Button
              type="button"
              size="lg"
              onClick={onImport}
              disabled={!isPickerValid}
            >
              <Download className="size-4" />
              Try import again
            </Button>
            <Button type="button" size="lg" variant="ghost" onClick={onRefresh}>
              <RefreshCw className="size-4" />
              Refresh sources
            </Button>
          </div>
        </>
      )}

      {phase === 'imported' && (
        <>
          <ImportedSummaryCard
            importedItemCount={completedItems}
            itemSummary={importedItemSummary}
            sourceName={sourceName}
          />
          <Button type="button" size="lg" onClick={onContinue}>
            <ArrowRight className="size-4" />
            Connect to Claude
          </Button>
        </>
      )}
    </StepWrap>
  )
}
