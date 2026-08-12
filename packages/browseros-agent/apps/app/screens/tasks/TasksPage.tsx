import { type FC, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { RunResultDialog } from '@/components/ai-elements/run-result-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  NEW_SCHEDULED_TASK_CREATED_EVENT,
  SCHEDULED_TASK_CANCELLED_EVENT,
  SCHEDULED_TASK_DELETED_EVENT,
  SCHEDULED_TASK_EDITED_EVENT,
  SCHEDULED_TASK_RETRIED_EVENT,
  SCHEDULED_TASK_TESTED_EVENT,
  SCHEDULED_TASK_TOGGLED_EVENT,
  SCHEDULED_TASK_VIEW_RESULTS_EVENT,
} from '@/lib/constants/analyticsEvents'
import { track } from '@/lib/metrics/track'
import {
  useScheduledJobRuns,
  useScheduledJobs,
} from '@/lib/schedules/scheduleStorage'
import type {
  ScheduledJob,
  ScheduledJobRun,
} from '@/lib/schedules/scheduleTypes'
import { AutomationsPanel } from '@/screens/scheduled-tasks/AutomationsPanel'
import { NewScheduledTaskDialog } from '@/screens/scheduled-tasks/NewScheduledTaskDialog'
import { ScheduledTaskResults } from '@/screens/scheduled-tasks/ScheduledTaskResults'
import { ScheduledTasksList } from '@/screens/scheduled-tasks/ScheduledTasksList'
import { TriggersPanel } from '@/screens/scheduled-tasks/TriggersPanel'
import { type Task, useTasks } from './useTasksApi'

export const TasksPage: FC = () => {
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    create,
    patch,
    refetch,
  } = useTasks('default')

  const { jobs, addJob, editJob, toggleJob, removeJob, runJob } =
    useScheduledJobs()
  const { jobRuns, cancelJobRun } = useScheduledJobRuns()

  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<string>('inbox')

  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam)
    } else {
      setActiveTab('inbox')
    }
  }, [tabParam])

  const handleTabChange = (val: string) => {
    setActiveTab(val)
    setSearchParams({ tab: val }, { replace: true })
  }

  // Inbox Task States
  const [title, setTitle] = useState('')
  const [promoteTask, setPromoteTask] = useState<Task | null>(null)
  const [isScheduledDialogOpen, setIsScheduledDialogOpen] = useState(false)

  const inbox = tasks.filter(
    (t) => t.status === 'inbox' || t.status === 'triaged',
  )
  const done = tasks.filter((t) => t.status === 'done')

  // Scheduled Task States
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null)
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null)
  const [viewingRunId, setViewingRunId] = useState<string | null>(null)
  const [prefillValues, setPrefillValues] = useState<ScheduledJob | null>(null)
  const prefillHandled = useRef(false)

  const viewingRun = viewingRunId
    ? (jobRuns.find((r) => r.id === viewingRunId) ?? null)
    : null

  useEffect(() => {
    if (prefillHandled.current) return
    if (searchParams.get('openDialog') !== 'true') return
    prefillHandled.current = true

    const prefill: ScheduledJob = {
      id: '',
      name: searchParams.get('name') ?? '',
      query: searchParams.get('query') ?? '',
      scheduleType:
        (searchParams.get('scheduleType') as ScheduledJob['scheduleType']) ??
        'daily',
      scheduleTime: searchParams.get('scheduleTime') ?? '09:00',
      scheduleInterval: 1,
      enabled: true,
      createdAt: '',
      updatedAt: '',
    }
    setPrefillValues(prefill)
    setEditingJob(null)
    setIsScheduledDialogOpen(true)
    setSearchParams({ tab: 'scheduled' }, { replace: true })
  }, [searchParams, setSearchParams])

  // Dialog prefills for task promotion
  const initialValues: ScheduledJob | null = promoteTask
    ? {
        id: '',
        name: promoteTask.title.slice(0, 60),
        query: promoteTask.title,
        scheduleType: 'daily',
        scheduleTime: '09:00',
        enabled: true,
        createdAt: '',
        updatedAt: '',
      }
    : (editingJob ?? prefillValues)

  // Reset dialog prefill state on close, driven directly by the dialog's
  // onOpenChange rather than an effect keyed on isScheduledDialogOpen —
  // that effect also fires on mount (state starts false) and can race
  // with the openDialog prefill effect above, clobbering it.
  const handleScheduledDialogOpenChange = (open: boolean) => {
    setIsScheduledDialogOpen(open)
    if (!open) {
      setPromoteTask(null)
      setEditingJob(null)
      setPrefillValues(null)
    }
  }

  const handleAddScheduled = () => {
    setEditingJob(null)
    setPrefillValues(null)
    setIsScheduledDialogOpen(true)
  }

  const handleEditScheduled = (job: ScheduledJob) => {
    setEditingJob(job)
    setIsScheduledDialogOpen(true)
  }

  const handleDeleteScheduled = (jobId: string) => {
    setDeleteJobId(jobId)
  }

  const confirmDeleteScheduled = async () => {
    if (deleteJobId) {
      await removeJob(deleteJobId)
      setDeleteJobId(null)
      track(SCHEDULED_TASK_DELETED_EVENT)
    }
  }

  const handleSaveScheduled = async (
    data: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt'>,
  ) => {
    if (editingJob) {
      await editJob(editingJob.id, data)
      track(SCHEDULED_TASK_EDITED_EVENT, {
        scheduleType: data.scheduleType,
        interval: data.scheduleInterval,
        time: data.scheduleTime,
      })
    } else {
      const job = await addJob(data)
      if (promoteTask && job?.id) {
        patch.mutate({
          id: promoteTask.id,
          scheduledJobId: job.id,
          status: 'triaged',
        })
      }
      handleTabChange('scheduled')
      track(NEW_SCHEDULED_TASK_CREATED_EVENT, {
        scheduleType: data.scheduleType,
        interval: data.scheduleInterval,
        time: data.scheduleTime,
      })
    }
    handleScheduledDialogOpenChange(false)
  }

  const handleToggleScheduled = async (jobId: string, enabled: boolean) => {
    await toggleJob(jobId, enabled)
    track(SCHEDULED_TASK_TOGGLED_EVENT)
  }

  const handleRunScheduled = async (jobId: string) => {
    await runJob(jobId)
    track(SCHEDULED_TASK_TESTED_EVENT)
  }

  const handleCancelRun = async (runId: string) => {
    await cancelJobRun(runId)
    track(SCHEDULED_TASK_CANCELLED_EVENT)
  }

  const handleRetryRun = async (jobId: string) => {
    await runJob(jobId)
    track(SCHEDULED_TASK_RETRIED_EVENT)
  }

  const handleViewRun = (run: ScheduledJobRun) => {
    setViewingRunId(run.id)
    track(SCHEDULED_TASK_VIEW_RESULTS_EVENT)
  }

  const jobToDelete = deleteJobId
    ? jobs.find((j) => j.id === deleteJobId)
    : null

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">
            Tasks & Workflows
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Manage your agent follow-ups, scheduled automation tasks, and
            execution logs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'scheduled' && (
            <Button size="sm" onClick={handleAddScheduled}>
              Add scheduled task
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled Tasks</TabsTrigger>
          <TabsTrigger value="results">History</TabsTrigger>
          <TabsTrigger value="triggers">Triggers</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="space-y-4">
          <form
            className="flex gap-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!title.trim()) return
              create.mutate(
                { title: title.trim() },
                { onSuccess: () => setTitle('') },
              )
            }}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add a task…"
            />
            <Button type="submit" disabled={create.isPending || !title.trim()}>
              Add
            </Button>
          </form>

          {tasksLoading && (
            <p className="text-muted-foreground text-sm">Loading tasks…</p>
          )}
          {tasksError && (
            <p className="text-destructive text-sm">
              {tasksError instanceof Error
                ? tasksError.message
                : 'Failed to load tasks'}
            </p>
          )}

          {!tasksLoading && inbox.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="font-medium text-sm">No tasks yet</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Type a task above and press Add, or Pane will suggest follow-ups
                from your browsing and conversations.
              </p>
            </div>
          )}

          <ul className="space-y-3">
            {inbox.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 text-sm"
              >
                <div>
                  <div className="font-medium">{task.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {task.status}
                    {task.scheduledJobId ? ' · scheduled' : ''}
                    {task.nodeIds?.length
                      ? ` · ${task.nodeIds.length} linked`
                      : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {task.status === 'inbox' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        patch.mutate({ id: task.id, status: 'triaged' })
                      }
                    >
                      Triage
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patch.mutate({ id: task.id, status: 'done' })
                    }
                  >
                    Done
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setPromoteTask(task)
                      setIsScheduledDialogOpen(true)
                    }}
                  >
                    Save as scheduled
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {done.length > 0 && (
            <section className="space-y-2 pt-4">
              <h2 className="font-medium text-sm">Done</h2>
              <ul className="space-y-1 text-muted-foreground text-sm">
                {done.map((t) => (
                  <li key={t.id}>{t.title}</li>
                ))}
              </ul>
            </section>
          )}
        </TabsContent>

        <TabsContent value="scheduled">
          <ScheduledTasksList
            jobs={jobs}
            onEdit={handleEditScheduled}
            onDelete={handleDeleteScheduled}
            onToggle={handleToggleScheduled}
            onRun={handleRunScheduled}
            onViewRun={handleViewRun}
            onCancelRun={handleCancelRun}
            onRetryRun={handleRetryRun}
          />
        </TabsContent>

        <TabsContent value="results">
          <ScheduledTaskResults
            onViewRun={handleViewRun}
            onCancelRun={handleCancelRun}
            onRetryRun={handleRetryRun}
          />
        </TabsContent>

        <TabsContent value="triggers">
          <TriggersPanel />
        </TabsContent>

        <TabsContent value="automations">
          <AutomationsPanel />
        </TabsContent>
      </Tabs>

      <NewScheduledTaskDialog
        open={isScheduledDialogOpen}
        onOpenChange={handleScheduledDialogOpenChange}
        initialValues={initialValues}
        onSave={handleSaveScheduled}
      />

      <RunResultDialog
        run={viewingRun}
        jobName={
          viewingRun
            ? jobs.find((j) => j.id === viewingRun.jobId)?.name
            : undefined
        }
        onOpenChange={(open) => !open && setViewingRunId(null)}
        onCancelRun={handleCancelRun}
        onRetryRun={(jobId) => {
          handleRetryRun(jobId)
          setViewingRunId(null)
        }}
      />

      <AlertDialog
        open={deleteJobId !== null}
        onOpenChange={(open) => !open && setDeleteJobId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scheduled Task</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{jobToDelete?.name}"? This will also remove all run
              history for this task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteScheduled}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
