import { describe, expect, test } from 'bun:test'
import { deriveApprovalCardPhase } from './approval-card-phase'

describe('deriveApprovalCardPhase', () => {
  const base = {
    toolState: 'approval-responded' as const,
    approved: true as boolean | undefined,
    chatStatus: 'ready' as string,
    approvalResumeInFlight: false,
    hasPendingSiblingApprovals: false,
    isDryRun: false,
  }

  test('approval-requested → waiting', () => {
    expect(
      deriveApprovalCardPhase({
        ...base,
        toolState: 'approval-requested',
        approved: undefined,
      }),
    ).toBe('waiting')
  })

  test('dry-run preview → dry-run', () => {
    expect(
      deriveApprovalCardPhase({
        ...base,
        toolState: 'output-available',
        isDryRun: true,
      }),
    ).toBe('dry-run')
  })

  test('responded + pending siblings → waiting-siblings', () => {
    expect(
      deriveApprovalCardPhase({
        ...base,
        hasPendingSiblingApprovals: true,
      }),
    ).toBe('waiting-siblings')
  })

  test('responded + approvalResumeInFlight → resume-pending', () => {
    expect(
      deriveApprovalCardPhase({
        ...base,
        approvalResumeInFlight: true,
      }),
    ).toBe('resume-pending')
  })

  test('responded + submitted/streaming → resume-pending', () => {
    expect(deriveApprovalCardPhase({ ...base, chatStatus: 'submitted' })).toBe(
      'resume-pending',
    )
    expect(deriveApprovalCardPhase({ ...base, chatStatus: 'streaming' })).toBe(
      'resume-pending',
    )
  })

  test('responded + idle + approved true → resume-failed', () => {
    expect(deriveApprovalCardPhase(base)).toBe('resume-failed')
  })

  test('responded + idle + approved false → denied-idle (no retry)', () => {
    expect(deriveApprovalCardPhase({ ...base, approved: false })).toBe(
      'denied-idle',
    )
  })

  test('siblings take priority over idle failure', () => {
    expect(
      deriveApprovalCardPhase({
        ...base,
        hasPendingSiblingApprovals: true,
        approvalResumeInFlight: false,
        chatStatus: 'ready',
      }),
    ).toBe('waiting-siblings')
  })

  test('in-flight takes priority when siblings are cleared', () => {
    expect(
      deriveApprovalCardPhase({
        ...base,
        approvalResumeInFlight: true,
        hasPendingSiblingApprovals: false,
      }),
    ).toBe('resume-pending')
  })

  test('unrelated state → hidden', () => {
    expect(
      deriveApprovalCardPhase({
        ...base,
        toolState: 'output-available',
        isDryRun: false,
      }),
    ).toBe('hidden')
  })
})
