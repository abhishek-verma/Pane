import { afterEach, beforeEach, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import {
  createScheduledJob,
  deleteScheduledJob,
  enqueueDueScheduledJobs,
  enqueueScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
} from '../../src/scheduler/jobs-store'
import {
  claimScheduledRun,
  listScheduledRuns,
} from '../../src/scheduler/run-executor'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pane-jobs-'))
  initializeDb({ dbPath: join(dir, 'db.sqlite') })
})
afterEach(() => {
  closeDb()
  rmSync(dir, { recursive: true, force: true })
})
const input = {
  name: 'Codex check',
  query: 'Read files and PI',
  scheduleType: 'minutes' as const,
  scheduleInterval: 1,
  enabled: true,
  providerId: 'codex-id',
  userWorkingDir: '/test/workspace',
  bucketId: 'work',
}
it('persists a schedule and fires a due slot only once, retaining its execution context', () => {
  const job = createScheduledJob(input, 1000)
  closeDb()
  initializeDb({ dbPath: join(dir, 'db.sqlite') })
  expect(listScheduledJobs()[0].id).toBe(job.id)
  expect(enqueueDueScheduledJobs(60999)).toHaveLength(0)
  const [run] = enqueueDueScheduledJobs(61000)
  expect(run.executionContext).toEqual({
    providerId: 'codex-id',
    userWorkingDir: '/test/workspace',
    bucketId: 'work',
  })
  expect(enqueueDueScheduledJobs(61000)).toHaveLength(0)
  expect(claimScheduledRun(run.id)?.status).toBe('running')
  expect(claimScheduledRun(run.id)).toBeNull()
  updateScheduledJob(
    job.id,
    { providerId: 'different', userWorkingDir: '/different', enabled: false },
    62000,
  )
  expect(listScheduledRuns()[0].executionContext?.providerId).toBe('codex-id')
  expect(enqueueDueScheduledJobs(200000)).toHaveLength(0)
})
it('manual runs work when paused and deletion retains evidence', () => {
  const job = createScheduledJob({ ...input, enabled: false })
  const run = enqueueScheduledJob(job.id, 'test')
  expect(enqueueScheduledJob(job.id, 'test').id).toBe(run.id)
  expect(deleteScheduledJob(job.id)).toBe(true)
  expect(listScheduledJobs()).toEqual([])
  expect(listScheduledRuns()[0].id).toBe(run.id)
})
it('rejects invalid daily times and missing intervals, and schedules the next local day', () => {
  expect(() =>
    createScheduledJob({ ...input, scheduleInterval: undefined }),
  ).toThrow('scheduleInterval')
  expect(() =>
    createScheduledJob({
      ...input,
      scheduleType: 'daily',
      scheduleTime: '25:00',
    }),
  ).toThrow()
  const now = new Date(2026, 8, 8, 10, 0).getTime()
  const job = createScheduledJob(
    { ...input, scheduleType: 'daily', scheduleTime: '09:00' },
    now,
  )
  expect(new Date(job.nextRunAt).getDate()).toBe(9)
  expect(new Date(job.nextRunAt).getHours()).toBe(9)
})
it('does not overlap a running schedule and does not move its due time when only its prompt changes', () => {
  const job = createScheduledJob(input, 1000)
  updateScheduledJob(job.id, { query: 'Updated prompt' }, 2000)
  expect(listScheduledJobs()[0].nextRunAt).toBe(61000)
  const [run] = enqueueDueScheduledJobs(61000)
  claimScheduledRun(run.id)
  expect(enqueueDueScheduledJobs(200000)).toHaveLength(0)
  expect(listScheduledRuns()).toHaveLength(1)
})
