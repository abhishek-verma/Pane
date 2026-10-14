import { expect, test } from 'bun:test'
import type { ExecutionTaskRecord } from './types'
import { ExecutionHistoryWriteBuffer } from './write-buffer'

const task = (
  id: string,
  responsePreview: string,
  status = 'running',
): ExecutionTaskRecord => ({
  id,
  conversationId: 'chat',
  promptText: 'hello',
  startedAt: 'now',
  status: status as ExecutionTaskRecord['status'],
  responsePreview,
  actionCount: 0,
  approvalCount: 0,
  deniedCount: 0,
  errorCount: 0,
  steps: [],
})

test('1000 streamed updates behind slow storage produce only the latest pending write', async () => {
  const writes: ExecutionTaskRecord[] = []
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const writer = new ExecutionHistoryWriteBuffer(
    async (next) => {
      writes.push(next)
      if (writes.length === 1) await blocked
    },
    () => {},
  )
  writer.enqueue(task('turn', 'start'))
  const first = writer.flush()
  for (let i = 0; i < 1000; i++) writer.enqueue(task('turn', String(i)))
  writer.enqueue(task('turn', 'finished', 'completed'))
  expect(writes).toHaveLength(1)
  release()
  await first
  await writer.flush()
  expect(writes.map((value) => value.responsePreview)).toEqual([
    'start',
    'finished',
  ])
  expect(writes[1].status).toBe('completed')
})

test('deduplicates unchanged running state and preserves terminal states across tasks', async () => {
  const writes: ExecutionTaskRecord[] = []
  const writer = new ExecutionHistoryWriteBuffer(
    async (next) => {
      writes.push(next)
    },
    () => {},
  )
  writer.enqueue(task('a', 'same'))
  await writer.flush()
  writer.enqueue(task('a', 'same'))
  await writer.flush()
  expect(writes).toHaveLength(1)
  writer.enqueue(task('a', 'done', 'completed'))
  writer.enqueue(task('b', 'failed', 'failed'))
  await writer.flush()
  expect(writes.map((value) => value.status)).toEqual([
    'running',
    'completed',
    'failed',
  ])
})

test('a storage error does not strand subsequent task updates', async () => {
  let attempts = 0
  const errors: unknown[] = []
  const writer = new ExecutionHistoryWriteBuffer(
    async () => {
      if (++attempts === 1) throw new Error('temporarily unavailable')
    },
    (error) => {
      errors.push(error)
    },
  )
  writer.enqueue(task('a', 'start'))
  await writer.flush()
  writer.enqueue(task('a', 'done', 'completed'))
  await writer.flush()
  expect(attempts).toBe(2)
  expect(errors).toHaveLength(1)
})
