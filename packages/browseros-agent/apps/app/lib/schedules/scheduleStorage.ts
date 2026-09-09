import { useQuery, useQueryClient } from '@tanstack/react-query'
import { storage } from '@wxt-dev/storage'
import { useEffect, useState } from 'react'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { resolveStoredChatProvider } from '@/lib/llm-providers/storage'
import { sendScheduleMessage } from '@/lib/messaging/schedules/scheduleMessages'
import { selectedWorkspaceStorage } from '@/lib/workspace/workspace-storage'
import { createAlarmFromJob } from './createAlarmFromJob'
import { nudgeDrainServerRuns } from './nudgeDrainServerRuns'
import type { ScheduledJob, ScheduledJobRun } from './scheduleTypes'

const getAlarmName = (jobId: string) => `scheduled-job-${jobId}`

export const scheduledJobStorage = storage.defineItem<ScheduledJob[]>(
  'local:scheduledJobs',
  {
    fallback: [],
  },
)

export const scheduledJobRunStorage = storage.defineItem<ScheduledJobRun[]>(
  'local:scheduledJobRuns',
  {
    fallback: [],
  },
)

export const pendingDeletionStorage = storage.defineItem<string[]>(
  'local:scheduledJobsPendingDeletion',
  {
    fallback: [],
  },
)

const SERVER_JOBS_KEY = ['scheduler', 'jobs']
const SERVER_RUNS_KEY = ['scheduler', 'runs']
async function schedulerRequest(path: string, init?: RequestInit) {
  const base = await getAgentServerUrl()
  const response = await agentFetch(`${base}/scheduler/${path}`, init)
  if (!response.ok)
    throw new Error(`Scheduler request failed: ${response.status}`)
  return response.json()
}

export function useScheduledJobs() {
  const queryClient = useQueryClient()
  const serverJobs = useQuery({
    queryKey: SERVER_JOBS_KEY,
    queryFn: async () =>
      (await schedulerRequest('jobs')).jobs as ScheduledJob[],
    refetchInterval: 5000,
  })
  const [localJobs, setJobs] = useState<ScheduledJob[]>([])

  useEffect(() => {
    scheduledJobStorage.getValue().then(setJobs)
    const unwatch = scheduledJobStorage.watch((newValue) => {
      setJobs(newValue ?? [])
    })
    return unwatch
  }, [])

  const jobs = [...localJobs, ...(serverJobs.data ?? [])]
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: SERVER_JOBS_KEY })
    await queryClient.invalidateQueries({ queryKey: SERVER_RUNS_KEY })
  }

  const addJob = async (
    job: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    const workspace = await selectedWorkspaceStorage.getValue()
    const provider = await resolveStoredChatProvider(job.providerId)
    const result = await schedulerRequest('jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...job,
        providerId: provider?.id,
        userWorkingDir: workspace?.path,
        workspaceId: workspace?.id,
        bucketId: workspace?.bucketId,
      }),
    })
    await invalidate()
    return result.job as ScheduledJob
  }

  const removeJob = async (id: string) => {
    if (jobs.find((job) => job.id === id)?.serverManaged) {
      await schedulerRequest(`jobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      await invalidate()
      return
    }
    await chrome.alarms.clear(getAlarmName(id))

    const pending = (await pendingDeletionStorage.getValue()) ?? []
    if (!pending.includes(id)) {
      await pendingDeletionStorage.setValue([...pending, id])
    }

    const currentJobs = (await scheduledJobStorage.getValue()) ?? []
    await scheduledJobStorage.setValue(currentJobs.filter((j) => j.id !== id))

    const currentRuns = (await scheduledJobRunStorage.getValue()) ?? []
    await scheduledJobRunStorage.setValue(
      currentRuns.filter((r) => r.jobId !== id),
    )
  }

  const toggleJob = async (id: string, enabled: boolean) => {
    if (jobs.find((job) => job.id === id)?.serverManaged) {
      await schedulerRequest(`jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      await invalidate()
      return
    }
    const current = (await scheduledJobStorage.getValue()) ?? []
    const job = current.find((j) => j.id === id)
    if (!job) return

    const updatedAt = new Date().toISOString()
    await scheduledJobStorage.setValue(
      current.map((j) => (j.id === id ? { ...j, enabled, updatedAt } : j)),
    )

    if (enabled) {
      await createAlarmFromJob({ ...job, enabled })
    } else {
      await chrome.alarms.clear(getAlarmName(id))
    }
  }

  const editJob = async (
    id: string,
    updates: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    const current = (await scheduledJobStorage.getValue()) ?? []
    const serverJob = jobs.find((job) => job.id === id && job.serverManaged)
    if (serverJob) {
      await schedulerRequest(`jobs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      await invalidate()
      return
    }
    const existingJob = current.find((j) => j.id === id)
    if (!existingJob) return

    const updatedJob: ScheduledJob = {
      id,
      createdAt: existingJob.createdAt,
      updatedAt: new Date().toISOString(),
      ...updates,
    }
    await scheduledJobStorage.setValue(
      current.map((j) => (j.id === id ? updatedJob : j)),
    )

    await chrome.alarms.clear(getAlarmName(id))
    if (updatedJob.enabled) {
      await createAlarmFromJob(updatedJob)
    }
  }

  const runJob = async (id: string) => {
    if (jobs.find((job) => job.id === id)?.serverManaged) {
      const { run } = await schedulerRequest(
        `jobs/${encodeURIComponent(id)}/run`,
        { method: 'POST' },
      )
      void nudgeDrainServerRuns({ runIds: [run.id] })
        .then(invalidate)
        .catch(() => undefined)
      await invalidate()
      return { success: true }
    }
    return sendScheduleMessage('runScheduledJob', { jobId: id })
  }

  return { jobs, addJob, removeJob, editJob, toggleJob, runJob }
}

export function useScheduledJobRuns() {
  const queryClient = useQueryClient()
  const serverRuns = useQuery({
    queryKey: SERVER_RUNS_KEY,
    queryFn: async () => {
      const { runs } = await schedulerRequest('runs')
      return runs
        .filter((run: { source: string }) => run.source === 'schedule')
        .map(
          (run: {
            id: string
            sourceId: string
            createdAt: number
            startedAt: number | null
            completedAt: number | null
            status: string
            result?: string
            error?: string
            conversationId?: string
          }) => ({
            id: run.id,
            jobId: run.sourceId,
            startedAt: new Date(run.startedAt ?? run.createdAt).toISOString(),
            completedAt: run.completedAt
              ? new Date(run.completedAt).toISOString()
              : undefined,
            status: ['pending', 'running', 'awaiting-approval'].includes(
              run.status,
            )
              ? 'running'
              : run.status === 'completed'
                ? 'completed'
                : 'failed',
            result: run.result ?? run.error,
            finalResult: run.result,
            error: run.error,
            conversationId: run.conversationId,
          }),
        ) as ScheduledJobRun[]
    },
    refetchInterval: 5000,
  })
  const [localRuns, setJobRuns] = useState<ScheduledJobRun[]>([])

  useEffect(() => {
    scheduledJobRunStorage.getValue().then(setJobRuns)
    const unwatch = scheduledJobRunStorage.watch((newValue) => {
      setJobRuns(newValue ?? [])
    })
    return unwatch
  }, [])

  const jobRuns = [...localRuns, ...(serverRuns.data ?? [])]

  const addJobRun = async (jobRun: ScheduledJobRun) => {
    const current = (await scheduledJobRunStorage.getValue()) ?? []
    await scheduledJobRunStorage.setValue([...current, jobRun])
  }

  const removeJobRun = async (id: string) => {
    if (serverRuns.data?.some((run) => run.id === id)) {
      await schedulerRequest(`runs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      await queryClient.invalidateQueries({ queryKey: SERVER_RUNS_KEY })
      return
    }
    const current = (await scheduledJobRunStorage.getValue()) ?? []
    await scheduledJobRunStorage.setValue(current.filter((r) => r.id !== id))
  }

  const editJobRun = async (
    id: string,
    updates: Partial<Omit<ScheduledJobRun, 'id'>>,
  ) => {
    const current = (await scheduledJobRunStorage.getValue()) ?? []
    await scheduledJobRunStorage.setValue(
      current.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    )
  }

  const cancelJobRun = async (runId: string) => {
    if (serverRuns.data?.some((run) => run.id === runId)) {
      const result = await schedulerRequest(
        `runs/${encodeURIComponent(runId)}/cancel`,
        { method: 'POST' },
      )
      await queryClient.invalidateQueries({ queryKey: SERVER_RUNS_KEY })
      return { success: result.cancelled }
    }
    return sendScheduleMessage('cancelScheduledJobRun', { runId })
  }

  return { jobRuns, addJobRun, removeJobRun, editJobRun, cancelJobRun }
}
