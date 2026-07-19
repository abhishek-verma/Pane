import type { ToolEvidenceState } from './types'

export function mapInvocationState(state: string): ToolEvidenceState {
  if (state === 'approval-requested') return 'approval'
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
