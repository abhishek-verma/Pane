export type ApprovalCardPhase =
  | 'hidden'
  | 'waiting'
  | 'dry-run'
  | 'waiting-siblings'
  | 'resume-pending'
  | 'resume-failed'
  | 'denied-idle'

export type DeriveApprovalCardPhaseInput = {
  toolState: string
  approved?: boolean
  chatStatus: string
  approvalResumeInFlight: boolean
  hasPendingSiblingApprovals: boolean
  isDryRun: boolean
}

/**
 * UI phase for ApprovalCard. Keep this pure so multi-approval / in-flight
 * honesty stays unit-tested without mounting React.
 *
 * Priority for approval-responded:
 * 1. pending siblings → waiting-siblings (resume intentionally withheld)
 * 2. resume in flight or chat busy → resume-pending
 * 3. approved === false → denied-idle (never offer Retry=Approve)
 * 4. else → resume-failed (true desync / network drop)
 */
export function deriveApprovalCardPhase(
  input: DeriveApprovalCardPhaseInput,
): ApprovalCardPhase {
  if (input.toolState === 'approval-requested') return 'waiting'
  if (input.toolState === 'output-available' && input.isDryRun) return 'dry-run'
  if (input.toolState !== 'approval-responded') return 'hidden'

  if (input.hasPendingSiblingApprovals) return 'waiting-siblings'

  const chatBusy =
    input.chatStatus === 'submitted' || input.chatStatus === 'streaming'
  if (input.approvalResumeInFlight || chatBusy) return 'resume-pending'

  if (input.approved === false) return 'denied-idle'
  return 'resume-failed'
}
