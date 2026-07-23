import type { ToolEvidenceState } from './types'

export function mapInvocationState(state: string): ToolEvidenceState {
  if (state === 'approval-requested') return 'approval'
  // User already answered. While a resume is in flight this is normal;
  // once idle, ApprovalCard decides between "Running…" (still busy via
  // status) and Retry/Deny (truly stuck / desynced). Keep mapping to
  // 'approval' so the card stays mounted either way.
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
