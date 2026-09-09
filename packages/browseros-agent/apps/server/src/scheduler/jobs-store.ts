import { z } from 'zod'
import { getDbHandle } from '../lib/db'
import { createRunRecord } from './run-executor'

export const ScheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  query: z.string().trim().min(1),
  scheduleType: z.enum(['daily', 'hourly', 'minutes']),
  scheduleTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  scheduleInterval: z.number().int().min(1).max(1440).optional(),
  enabled: z.boolean().default(true),
  providerId: z.string().min(1).optional(),
  userWorkingDir: z.string().min(1).optional(),
  workspaceId: z.string().optional(),
  bucketId: z.string().optional(),
})

export type ScheduleInput = z.infer<typeof ScheduleInputSchema>
export interface ServerScheduledJob extends ScheduleInput {
  id: string
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  nextRunAt: number
  serverManaged: true
}

function nextRun(input: ScheduleInput, now: number): number {
  if (input.scheduleType !== 'daily') {
    if (!input.scheduleInterval) throw new Error('scheduleInterval is required')
    return (
      now +
      input.scheduleInterval *
        (input.scheduleType === 'hourly' ? 3_600_000 : 60_000)
    )
  }
  if (!input.scheduleTime) throw new Error('scheduleTime is required')
  const [hour, minute] = input.scheduleTime.split(':').map(Number)
  const date = new Date(now)
  date.setHours(hour, minute, 0, 0)
  if (date.getTime() <= now) date.setDate(date.getDate() + 1)
  return date.getTime()
}

export function listScheduledJobs(): ServerScheduledJob[] {
  const rows = getDbHandle()
    .sqlite.query('SELECT definition_json FROM scheduled_jobs ORDER BY rowid')
    .all() as { definition_json: string }[]
  return rows.map((row) => JSON.parse(row.definition_json))
}

function getScheduledJob(id: string) {
  return listScheduledJobs().find((job) => job.id === id)
}

function save(job: ServerScheduledJob) {
  getDbHandle()
    .sqlite.query(
      'INSERT INTO scheduled_jobs (id, definition_json, next_run_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET definition_json = excluded.definition_json, next_run_at = excluded.next_run_at',
    )
    .run(job.id, JSON.stringify(job), job.nextRunAt)
  return job
}

export function createScheduledJob(input: ScheduleInput, now = Date.now()) {
  const parsed = ScheduleInputSchema.parse(input)
  return save({
    ...parsed,
    id: crypto.randomUUID(),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    nextRunAt: nextRun(parsed, now),
    serverManaged: true,
  })
}

export function updateScheduledJob(
  id: string,
  patch: Partial<ScheduleInput>,
  now = Date.now(),
) {
  const job = getScheduledJob(id)
  if (!job) throw new Error('Scheduled task not found')
  const parsed = ScheduleInputSchema.parse({ ...job, ...patch })
  return save({
    ...job,
    ...parsed,
    updatedAt: new Date(now).toISOString(),
    nextRunAt:
      patch.scheduleType !== undefined ||
      patch.scheduleTime !== undefined ||
      patch.scheduleInterval !== undefined ||
      (patch.enabled === true && !job.enabled)
        ? nextRun(parsed, now)
        : job.nextRunAt,
  })
}

export function deleteScheduledJob(id: string) {
  return (
    getDbHandle()
      .sqlite.query('DELETE FROM scheduled_jobs WHERE id = ?')
      .run(id).changes > 0
  )
}

export function enqueueScheduledJob(
  id: string,
  slot = `manual:${crypto.randomUUID()}`,
) {
  const job = getScheduledJob(id)
  if (!job) throw new Error('Scheduled task not found')
  return createRunRecord({
    source: 'schedule',
    sourceId: job.id,
    prompt: job.query,
    bucketId: job.bucketId,
    idempotencyKey: `schedule:${job.id}:${slot}`,
    executionContext: {
      providerId: job.providerId,
      userWorkingDir: job.userWorkingDir,
      workspaceId: job.workspaceId,
      bucketId: job.bucketId,
    },
    unattended: true,
  })
}

// The extension's existing minute alarm drains these rows. A transaction keeps
// a crash or concurrent poll from losing a due slot or enqueueing it twice.
export function enqueueDueScheduledJobs(now = Date.now()) {
  return getDbHandle().sqlite.transaction(() => {
    const runs = []
    for (const job of listScheduledJobs()) {
      if (!job.enabled || job.nextRunAt > now) continue
      const active = getDbHandle()
        .sqlite.query(
          "SELECT id FROM scheduled_runs WHERE source = 'schedule' AND source_id = ? AND status IN ('pending', 'running', 'awaiting-approval') LIMIT 1",
        )
        .get(job.id)
      if (active) continue
      runs.push(enqueueScheduledJob(job.id, String(job.nextRunAt)))
      save({
        ...job,
        lastRunAt: new Date(now).toISOString(),
        nextRunAt: nextRun(job, now),
      })
    }
    return runs
  })()
}
