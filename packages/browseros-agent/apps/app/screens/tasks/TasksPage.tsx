/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useScheduledJobs } from '@/lib/schedules/scheduleStorage'
import type { ScheduledJob } from '@/lib/schedules/scheduleTypes'
import { NewScheduledTaskDialog } from '@/screens/scheduled-tasks/NewScheduledTaskDialog'
import { type Task, useTasks } from './useTasksApi'

export const TasksPage: FC = () => {
  const { tasks, loading, error, create, patch, refetch } = useTasks('default')
  const { addJob } = useScheduledJobs()
  const [title, setTitle] = useState('')
  const [promoteTask, setPromoteTask] = useState<Task | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const inbox = tasks.filter(
    (t) => t.status === 'inbox' || t.status === 'triaged',
  )
  const done = tasks.filter((t) => t.status === 'done')

  // Prefill dialog when promoting: NewScheduledTaskDialog reads initialValues
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
    : null

  useEffect(() => {
    if (!dialogOpen) setPromoteTask(null)
  }, [dialogOpen])

  return (
    <div className="fade-in slide-in-from-bottom-5 animate-in space-y-6 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Tasks</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Inbox for follow-ups. Promote any task to a scheduled job.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      <form
        className="flex gap-2"
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

      {loading && (
        <p className="text-muted-foreground text-sm">Loading tasks…</p>
      )}
      {error && (
        <p className="text-destructive text-sm">
          {error instanceof Error ? error.message : 'Failed to load tasks'}
        </p>
      )}

      {!loading && inbox.length === 0 && (
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
                {task.nodeIds?.length ? ` · ${task.nodeIds.length} linked` : ''}
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
                onClick={() => patch.mutate({ id: task.id, status: 'done' })}
              >
                Done
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setPromoteTask(task)
                  setDialogOpen(true)
                }}
              >
                Save as scheduled
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-medium text-sm">Done</h2>
          <ul className="space-y-1 text-muted-foreground text-sm">
            {done.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </section>
      )}

      <NewScheduledTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialValues={initialValues}
        onSave={async (data) => {
          const job = await addJob(data)
          if (promoteTask && job?.id) {
            patch.mutate({
              id: promoteTask.id,
              scheduledJobId: job.id,
              status: 'triaged',
            })
          }
          setDialogOpen(false)
        }}
      />
    </div>
  )
}
