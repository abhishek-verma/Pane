import { describe, expect, test } from 'bun:test'
import { mapInvocationState } from './map-state'

describe('mapInvocationState', () => {
  test('maps approval-requested to approval', () => {
    expect(mapInvocationState('approval-requested')).toBe('approval')
  })

  test('maps approval-responded to approval, not running', () => {
    // Regression guard: a resume that never landed (aborted, server
    // restart) must not render as a permanently spinning tool card.
    expect(mapInvocationState('approval-responded')).toBe('approval')
  })

  test('maps denied states to denied', () => {
    expect(mapInvocationState('output-denied')).toBe('denied')
    expect(mapInvocationState('denied')).toBe('denied')
  })

  test('maps error states to error', () => {
    expect(mapInvocationState('output-error')).toBe('error')
    expect(mapInvocationState('error')).toBe('error')
    expect(mapInvocationState('failed')).toBe('error')
  })

  test('maps completed-ish states to completed', () => {
    for (const state of [
      'output-available',
      'result',
      'completed',
      'success',
      'succeeded',
      'done',
    ]) {
      expect(mapInvocationState(state)).toBe('completed')
    }
  })

  test('falls back to running for in-flight states', () => {
    expect(mapInvocationState('input-available')).toBe('running')
    expect(mapInvocationState('input-streaming')).toBe('running')
    expect(mapInvocationState('some-unknown-state')).toBe('running')
  })
})
