import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import type {
  ExecutionHistoryByConversation,
  ExecutionTaskRecord,
} from './types'

let legacy: ExecutionHistoryByConversation
let records: Record<string, unknown>
let writes: Record<string, unknown>[]
let legacyReads = 0
let legacyWrites = 0
mock.module('@wxt-dev/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => {
        legacyReads++
        return legacy
      },
      setValue: async (value: ExecutionHistoryByConversation) => {
        legacyWrites++
        legacy = value
      },
    }),
  },
}))
const { upsertConversationExecutionTask, removeConversationExecutionHistory } =
  await import('./storage')
const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome')
const task = (id: string, conversationId = 'chat'): ExecutionTaskRecord => ({
  id,
  conversationId,
  promptText: 'hello',
  startedAt: 'now',
  status: 'running',
  actionCount: 0,
  approvalCount: 0,
  deniedCount: 0,
  errorCount: 0,
  steps: [],
})
beforeEach(() => {
  legacy = {
    previous: {
      conversationId: 'previous',
      updatedAt: 1,
      tasks: [
        { ...task('old', 'previous'), responseText: 'x'.repeat(3_000_000) },
      ],
    },
  }
  records = {}
  writes = []
  legacyReads = 0
  legacyWrites = 0
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      storage: {
        local: {
          set: async (value: Record<string, unknown>) => {
            writes.push(value)
            Object.assign(records, value)
          },
          getKeys: async () => Object.keys(records),
          remove: async (keys: string[]) => {
            for (const key of keys) delete records[key]
          },
        },
      },
    },
  })
})
afterEach(() => {
  if (originalChrome)
    Object.defineProperty(globalThis, 'chrome', originalChrome)
  else Reflect.deleteProperty(globalThis, 'chrome')
})

test('a streaming update never reads or rewrites the multi-MB history archive', async () => {
  const original = legacy
  await upsertConversationExecutionTask(task('current'))
  expect(legacyReads).toBe(0)
  expect(legacyWrites).toBe(0)
  expect(legacy).toBe(original)
  expect(JSON.stringify(writes[0]).length).toBeLessThan(1000)
  expect(Object.values(records)).toEqual([task('current')])
})

test('concurrent tasks are independent and terminal updates replace only their task', async () => {
  await Promise.all([
    upsertConversationExecutionTask(task('a')),
    upsertConversationExecutionTask(task('b', 'other')),
  ])
  await upsertConversationExecutionTask({ ...task('a'), status: 'completed' })
  expect(Object.keys(records)).toHaveLength(2)
  expect(Object.values(records)).toContainEqual({
    ...task('a'),
    status: 'completed',
  })
  expect(Object.values(records)).toContainEqual(task('b', 'other'))
})

test('explicit deletion removes both formats only for the selected conversation', async () => {
  await upsertConversationExecutionTask(task('a', 'previous'))
  await upsertConversationExecutionTask(task('b', 'previous-other'))
  await removeConversationExecutionHistory('previous')
  expect(legacy.previous).toBeUndefined()
  expect(Object.values(records)).toEqual([task('b', 'previous-other')])
})

test('streaming burst stays independent of archive size and preserves the final task', async () => {
  const { ExecutionHistoryWriteBuffer } = await import('./write-buffer')
  const writer = new ExecutionHistoryWriteBuffer(
    upsertConversationExecutionTask,
    (error) => {
      throw error
    },
  )
  const archiveBytes = JSON.stringify(legacy).length
  for (let index = 0; index < 1000; index++) {
    writer.enqueue({ ...task('streamed'), responsePreview: `token ${index}` })
  }
  writer.enqueue({
    ...task('streamed'),
    status: 'completed',
    responsePreview: 'Finished',
  })
  await writer.flush()
  const writtenBytes = writes.reduce(
    (bytes, value) => bytes + JSON.stringify(value).length,
    0,
  )
  expect(archiveBytes).toBeGreaterThan(3_000_000)
  expect(writes).toHaveLength(1)
  expect(writtenBytes).toBeLessThan(1000)
  expect(legacyReads).toBe(0)
  expect(legacyWrites).toBe(0)
  expect(Object.values(records)).toEqual([
    { ...task('streamed'), status: 'completed', responsePreview: 'Finished' },
  ])
})
