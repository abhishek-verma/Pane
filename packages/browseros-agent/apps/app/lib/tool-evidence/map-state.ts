import type { ToolEvidenceState } from './types'

export function mapInvocationState(state: string): ToolEvidenceState {
  if (state === 'approval-requested') return 'approval'
  // The user already answered, but the resume that would execute the tool
  // never landed (aborted mid-flight, server restart, dropped request).
  // Falling through to 'running' here is what made these look like a
  // permanently spinning tool card — map to 'approval' so ToolBatch can
  // offer Retry/Deny instead of a dead spinner.
  if (state === 'approval-responded') return 'approval'
  if (state === 'output-denied' || state === 'denied') return 'denied'
  if (state === 'output-error' || state === 'error' || state === 'failed') {
    return 'error'
  }
  if (
    state === 'output-available' ||
    state === 'result' ||
    state === 'completed' ||
    state === 'success' ||
    state === 'succeeded' ||
    state === 'done'
  ) {
    return 'completed'
  }
  return 'running'
}
