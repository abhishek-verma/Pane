import { expect, it } from 'bun:test'
import { withRequestDeadline } from './request-deadline'

it('bounds reads even when browser setup ignores cancellation', async () => {
  let requestSignal: AbortSignal | undefined
  const read = withRequestDeadline(
    (signal) => {
      requestSignal = signal
      return new Promise(() => {})
    },
    { timeoutMs: 10 },
  )
  await expect(read).rejects.toThrow('too long')
  expect(requestSignal?.aborted).toBe(true)
})

it('bounds stalled response bodies as well as response headers', async () => {
  await expect(
    withRequestDeadline(
      async () => {
        const response = new Response(new ReadableStream({ start() {} }))
        return response.json()
      },
      { timeoutMs: 10 },
    ),
  ).rejects.toThrow('too long')
})

it('cancels an old read when navigating and allows a new read immediately', async () => {
  const old = new AbortController()
  const pending = withRequestDeadline(() => new Promise(() => {}), {
    signal: old.signal,
  })
  old.abort()
  await expect(pending).rejects.toThrow()
  expect(await withRequestDeadline(async () => 'new chat')).toBe('new chat')
})

it('does not start a read that has already been cancelled', async () => {
  const cancelled = new AbortController()
  cancelled.abort()
  let started = false
  await expect(
    withRequestDeadline(
      async () => {
        started = true
      },
      { signal: cancelled.signal },
    ),
  ).rejects.toThrow()
  expect(started).toBe(false)
})
