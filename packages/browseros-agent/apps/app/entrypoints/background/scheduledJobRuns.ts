import { cancelChatTurn } from '@/lib/conversations/chat-turn-api'
import { onScheduleMessage } from '@/lib/messaging/schedules/scheduleMessages'
import { createAlarmFromJob } from '@/lib/schedules/createAlarmFromJob'
import { getChatServerResponse } from '@/lib/schedules/getChatServerResponse'
import {
  scheduledJobRunStorage,
  scheduledJobStorage,
} from '@/lib/schedules/scheduleStorage'
import type { ScheduledJobRun } from '@/lib/schedules/scheduleTypes'

const MAX_RUNS_PER_JOB = 15
const STALE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

const runAbortControllers = new Map<
  string,
  { controller: AbortController; conversationId: string }
>()

export const scheduledJobRuns = async () => {
  const cleanupStaleJobRuns = async () => {
    const current = (await scheduledJobRunStorage.getValue()) ?? []
    const now = Date.now()

    const updated = await Promise.all(
      current.map(async (run) => {
        if (run.status !== 'running') return run

        const startedAt = new Date(run.startedAt).getTime()
        if (now - startedAt <= STALE_TIMEOUT_MS) return run

        // Explicitly cancel the server turn — detachable turns survive fetch abort alone.
        const entry = runAbortControllers.get(run.id)
        const conversationId = entry?.conversationId ?? run.conversationId
        if (conversationId) {
          await cancelChatTurn(conversationId, {
            reason: 'scheduled-job-stale-timeout',
          }).catch(() => {})
        }
        entry?.controller.abort()
        runAbortControllers.delete(run.id)

        return {
          ...run,
          status: 'failed' as const,
          completedAt: new Date().toISOString(),
          result: 'Job timed out!',
          // Keep completedSteps so a resume can skip consequential work.
          completedSteps: run.completedSteps ?? [],
        }
      }),
    )

    await scheduledJobRunStorage.setValue(updated)
  }

  const syncAlarmState = async () => {
    const jobs = (await scheduledJobStorage.getValue()).filter(
      (each) => each.enabled,
    )

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      const alarmName = `scheduled-job-${job.id}`
      const existingAlarm = await chrome.alarms.get(alarmName)

      if (!existingAlarm) {
        await createAlarmFromJob(job)
      }
    }
  }

  const createJobRun = async (
    jobId: string,
    status: ScheduledJobRun['status'],
  ): Promise<ScheduledJobRun> => {
    const id = crypto.randomUUID()
    // Slot = calendar minute of fire — stable across crash/retry in the same minute.
    const slot = new Date().toISOString().slice(0, 16)
    const idempotencyKey = `${jobId}:${slot}`

    const current = (await scheduledJobRunStorage.getValue()) ?? []
    const prior = current.find(
      (r) =>
        r.jobId === jobId &&
        r.idempotencyKey === idempotencyKey &&
        r.status === 'failed' &&
        (r.completedSteps?.length ?? 0) > 0,
    )

    const jobRun: ScheduledJobRun = {
      id,
      jobId,
      startedAt: new Date().toISOString(),
      status,
      idempotencyKey,
      completedSteps: prior?.completedSteps ?? [],
    }

    const otherJobRuns = current.filter((r) => r.jobId !== jobId)
    const thisJobRuns = current
      .filter((r) => r.jobId === jobId)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      .slice(0, MAX_RUNS_PER_JOB - 1)

    await scheduledJobRunStorage.setValue([
      ...otherJobRuns,
      ...thisJobRuns,
      jobRun,
    ])
    return jobRun
  }

  const updateJobRun = async (
    runId: string,
    updates: Partial<Omit<ScheduledJobRun, 'id' | 'jobId' | 'startedAt'>>,
  ) => {
    const current = (await scheduledJobRunStorage.getValue()) ?? []
    await scheduledJobRunStorage.setValue(
      current.map((r) => (r.id === runId ? { ...r, ...updates } : r)),
    )
  }

  const updateJobLastRunAt = async (jobId: string) => {
    const current = (await scheduledJobStorage.getValue()) ?? []
    await scheduledJobStorage.setValue(
      current.map((j) =>
        j.id === jobId ? { ...j, lastRunAt: new Date().toISOString() } : j,
      ),
    )
  }

  const executeScheduledJob = async (jobId: string): Promise<void> => {
    const job = (await scheduledJobStorage.getValue()).find(
      (each) => each.id === jobId,
    )

    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    const jobRun = await createJobRun(jobId, 'running')
    const conversationId = crypto.randomUUID()
    const abortController = new AbortController()
    runAbortControllers.set(jobRun.id, {
      controller: abortController,
      conversationId,
    })
    await updateJobRun(jobRun.id, { conversationId })

    try {
      const response = await getChatServerResponse({
        message: job.query,
        conversationId,
        signal: abortController.signal,
        providerId: job.providerId,
        idempotencyKey: jobRun.idempotencyKey,
      })

      await updateJobRun(jobRun.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: response.text,
        finalResult: response.finalResult,
        executionLog: response.executionLog,
        toolCalls: response.toolCalls,
        conversationId: response.conversationId,
      })
    } catch (e) {
      const isCancelled = abortController.signal.aborted
      const errorMessage = isCancelled
        ? 'Cancelled by user'
        : e instanceof Error
          ? e.message
          : String(e)
      await updateJobRun(jobRun.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        result: errorMessage,
        error: errorMessage,
      })
    } finally {
      runAbortControllers.delete(jobRun.id)
      await updateJobLastRunAt(jobId)
    }
  }

  let runningMissedJobs = false

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO(dani) refactor to reduce complexity
  const runMissedJobs = async () => {
    if (runningMissedJobs) return
    runningMissedJobs = true

    try {
      const jobs = (await scheduledJobStorage.getValue()).filter(
        (j) => j.enabled,
      )
      const runs = (await scheduledJobRunStorage.getValue()) ?? []
      const now = Date.now()
      const cutoff = now - TWENTY_FOUR_HOURS_MS

      for (const job of jobs) {
        const hasRecentRun = runs.some(
          (r) => r.jobId === job.id && new Date(r.startedAt).getTime() > cutoff,
        )
        if (hasRecentRun) continue

        const hasRunningRun = runs.some(
          (r) => r.jobId === job.id && r.status === 'running',
        )
        if (hasRunningRun) continue

        if (job.scheduleType === 'daily' && job.scheduleTime) {
          const [hours, minutes] = job.scheduleTime.split(':').map(Number)
          const scheduledToday = new Date()
          scheduledToday.setHours(hours, minutes, 0, 0)
          if (now < scheduledToday.getTime()) continue
        }

        if (
          (job.scheduleType === 'hourly' || job.scheduleType === 'minutes') &&
          job.scheduleInterval
        ) {
          const intervalMs =
            job.scheduleType === 'hourly'
              ? job.scheduleInterval * 60 * 60 * 1000
              : job.scheduleInterval * 60 * 1000
          const createdAt = new Date(job.createdAt).getTime()
          if (now - createdAt < intervalMs) continue
        }

        await executeScheduledJob(job.id)
      }
    } finally {
      runningMissedJobs = false
    }
  }

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('scheduled-job-')) return
    const jobId = alarm.name.replace('scheduled-job-', '')
    await executeScheduledJob(jobId)
  })

  onScheduleMessage('runScheduledJob', async ({ data }) => {
    try {
      await executeScheduledJob(data.jobId)
      return { success: true }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      }
    }
  })

  onScheduleMessage('cancelScheduledJobRun', async ({ data }) => {
    const entry = runAbortControllers.get(data.runId)
    if (!entry) {
      // Run may have finished locally; still try cancel via stored conversationId.
      const runs = (await scheduledJobRunStorage.getValue()) ?? []
      const run = runs.find((r) => r.id === data.runId)
      if (run?.conversationId) {
        await cancelChatTurn(run.conversationId, {
          reason: 'scheduled-job-cancelled',
        }).catch(() => {})
      }
      return { success: false, error: 'Run not found or already completed' }
    }
    // Explicit cancel API — do not rely on fetch abort alone.
    await cancelChatTurn(entry.conversationId, {
      reason: 'scheduled-job-cancelled',
    }).catch(() => {})
    entry.controller.abort()
    return { success: true }
  })

  chrome.runtime.onStartup.addListener(async () => {
    await cleanupStaleJobRuns()
    await syncAlarmState()
    await runMissedJobs()
  })

  chrome.runtime.onInstalled.addListener(async () => {
    await cleanupStaleJobRuns()
    await syncAlarmState()
    await runMissedJobs()
  })
}
