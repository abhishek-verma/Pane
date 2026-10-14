import { expect, mock, test } from 'bun:test'
import { startVisibleChatFollower } from './visible-chat-follower'

class Visibility extends EventTarget {
  hidden = false
  set(hidden: boolean) {
    this.hidden = hidden
    this.dispatchEvent(new Event('visibilitychange'))
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

test('hidden views do no polling and catch up immediately when shown', async () => {
  const document = new Visibility()
  document.hidden = true
  const check = mock(async (_context: { resumed: boolean }) => {})
  const detach = mock(() => {})
  const stop = startVisibleChatFollower({
    document,
    check,
    detach,
    intervalMs: 5,
  })
  try {
    await tick()
    expect(check).not.toHaveBeenCalled()
    document.set(false)
    expect(check).toHaveBeenCalledTimes(1)
    expect(check.mock.calls[0][0].resumed).toBe(true)
    await tick()
    expect(check.mock.calls.at(-1)?.[0].resumed).toBe(false)
    document.set(true)
    expect(detach).toHaveBeenCalledTimes(1)
    const before = check.mock.calls.length
    await tick()
    expect(check).toHaveBeenCalledTimes(before)
    document.set(false)
    expect(check.mock.calls.at(-1)?.[0].resumed).toBe(true)
  } finally {
    stop()
  }
  const before = check.mock.calls.length
  document.set(false)
  await tick()
  expect(check).toHaveBeenCalledTimes(before)
})

test('hide/show invalidates an in-flight probe and runs one fresh probe after it', async () => {
  const document = new Visibility()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const applied: boolean[] = []
  let calls = 0
  const stop = startVisibleChatFollower({
    document,
    detach: () => {},
    check: async ({ isCurrent, resumed }) => {
      calls++
      if (calls === 1) await pending
      applied.push(isCurrent())
      expect(resumed).toBe(true)
    },
  })
  try {
    document.set(true)
    document.set(false)
    expect(calls).toBe(1)
    release()
    await tick()
    expect(calls).toBe(2)
    expect(applied).toEqual([false, true])
  } finally {
    stop()
  }
})

test('disposing invalidates late completion without restarting', async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let current = true
  const check = mock(async ({ isCurrent }: { isCurrent: () => boolean }) => {
    await pending
    current = isCurrent()
  })
  const detach = mock(() => {})
  const stop = startVisibleChatFollower({
    document: new Visibility(),
    check,
    detach,
  })
  stop()
  release()
  await tick()
  expect(current).toBe(false)
  expect(check).toHaveBeenCalledTimes(1)
  expect(detach).toHaveBeenCalledTimes(1)
})

test('transient failures retry and independent visible windows keep following', async () => {
  const a = new Visibility()
  const b = new Visibility()
  const first = mock(async () => {
    throw new Error('temporary offline')
  })
  const second = mock(async () => {})
  const stopA = startVisibleChatFollower({
    document: a,
    check: first,
    detach: () => {},
    intervalMs: 5,
  })
  const stopB = startVisibleChatFollower({
    document: b,
    check: second,
    detach: () => {},
    intervalMs: 5,
  })
  try {
    await tick()
    expect(first.mock.calls.length).toBeGreaterThan(1)
    expect(second.mock.calls.length).toBeGreaterThan(1)
    a.set(true)
    const before = first.mock.calls.length
    await tick()
    expect(first).toHaveBeenCalledTimes(before)
    expect(second.mock.calls.length).toBeGreaterThan(before)
  } finally {
    stopA()
    stopB()
  }
})
