import { expect, mock, test } from 'bun:test'
import { ChatCompletionTracker } from './chat-completion-tracker'

test('background queued turns trigger completion effects once while the SDK stays ready', () => {
  const tracker = new ChatCompletionTracker()
  const clearSelection = mock(() => {})
  const saveCloudHistory = mock(() => {})
  const invalidateHistory = mock(() => {})
  const invalidateCredits = mock(() => {})
  for (const repositoryBusy of [false, true, true, false, false]) {
    if (
      tracker.update({
        conversationId: 'chat',
        status: 'ready',
        repositoryBusy,
      })
    ) {
      clearSelection()
      saveCloudHistory()
      invalidateHistory()
      invalidateCredits()
    }
  }
  for (const effect of [
    clearSelection,
    saveCloudHistory,
    invalidateHistory,
    invalidateCredits,
  ])
    expect(effect).toHaveBeenCalledTimes(1)
})

test('SDK completion waits until the repository also settles', () => {
  const tracker = new ChatCompletionTracker()
  expect(
    tracker.update({
      conversationId: 'chat',
      status: 'streaming',
      repositoryBusy: true,
    }),
  ).toBe(false)
  expect(
    tracker.update({
      conversationId: 'chat',
      status: 'ready',
      repositoryBusy: true,
    }),
  ).toBe(false)
  expect(
    tracker.update({
      conversationId: 'chat',
      status: 'ready',
      repositoryBusy: false,
    }),
  ).toBe(true)
})

test('navigation and initial history restoration are not turn completions', () => {
  const tracker = new ChatCompletionTracker()
  expect(
    tracker.update({
      conversationId: 'first',
      status: 'ready',
      repositoryBusy: true,
    }),
  ).toBe(false)
  expect(
    tracker.update({
      conversationId: 'second',
      status: 'ready',
      repositoryBusy: false,
    }),
  ).toBe(false)
  expect(
    tracker.update({
      conversationId: 'first',
      status: 'ready',
      repositoryBusy: false,
    }),
  ).toBe(false)
})
