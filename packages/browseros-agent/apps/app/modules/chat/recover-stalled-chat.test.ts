import { expect, mock, test } from 'bun:test'
import type { ChatTurnController } from './chat-turn-controller'
import { recoverStalledChat } from './recover-stalled-chat'

function controller(active: boolean, known = true) {
  return {
    refreshActive: mock(async () => active),
    hasResolvedActivity: known,
    markInactive: mock(() => {}),
    ensureAttached: mock(() => {}),
  }
}

test('unblocks a finished subscriber without requiring history changes or assistant text', async () => {
  const state = controller(false)
  const stop = mock(() => {})
  await recoverStalledChat({
    controller: state as unknown as ChatTurnController,
    isCurrent: () => true,
    stopSubscriber: stop,
  })
  expect(stop).toHaveBeenCalledTimes(1)
  expect(state.markInactive).toHaveBeenCalledTimes(1)
})

test('does not stop a running turn', async () => {
  const state = controller(true)
  const stop = mock(() => {})
  await recoverStalledChat({
    controller: state as unknown as ChatTurnController,
    isCurrent: () => true,
    stopSubscriber: stop,
  })
  expect(stop).not.toHaveBeenCalled()
  expect(state.markInactive).not.toHaveBeenCalled()
})

for (const [known, current] of [
  [false, true],
  [true, false],
]) {
  test(`does not stop on unknown liveness or a stale probe (${known}, ${current})`, async () => {
    const state = controller(false, known)
    const stop = mock(() => {})
    await recoverStalledChat({
      controller: state as unknown as ChatTurnController,
      isCurrent: () => current,
      stopSubscriber: stop,
    })
    expect(stop).not.toHaveBeenCalled()
    expect(state.markInactive).not.toHaveBeenCalled()
  })
}
