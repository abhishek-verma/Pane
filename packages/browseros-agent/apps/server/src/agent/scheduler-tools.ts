/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import {
  createScheduledJob,
  deleteScheduledJob,
  enqueueScheduledJob,
  listScheduledJobs,
  ScheduleInputSchema,
  updateScheduledJob,
} from '../scheduler/jobs-store'
import { deleteTriggerRule, listTriggerRules } from '../scheduler/rules-store'
import { listScheduledRuns } from '../scheduler/run-executor'
import type { PaneToolContext } from './pane-toolset'

export function buildSchedulerToolSet(context: PaneToolContext = {}): ToolSet {
  return {
    schedule_create: tool({
      description:
        'Create and persist a scheduled agent task when the user asks to schedule or automate work. Inherits the current provider and workspace unless explicitly supplied. Daily times use the local machine timezone. Pane must be running to execute jobs. Use schedule_list first to avoid duplicates.',
      inputSchema: ScheduleInputSchema,
      execute: async (input) => ({
        job: createScheduledJob({
          ...input,
          providerId: input.providerId ?? context.providerId,
          userWorkingDir:
            input.userWorkingDir ?? context.workingDir ?? undefined,
          workspaceId: input.workspaceId ?? context.workspaceId,
          bucketId: input.bucketId ?? context.bucketId,
        }),
      }),
    }),
    schedule_list: tool({
      description:
        'List persisted server scheduled tasks, their provider/workspace, next due time, and recent execution results.',
      inputSchema: z.object({}),
      execute: async () => ({
        jobs: listScheduledJobs(),
        runs: listScheduledRuns({ limit: 200 }).filter(
          (run) => run.source === 'schedule',
        ),
      }),
    }),
    schedule_update: tool({
      description:
        'Update or pause an existing scheduled task. Read schedule_list first. Set enabled=false to pause.',
      inputSchema: z.object({
        jobId: z.string().min(1),
        updates: ScheduleInputSchema.partial(),
      }),
      execute: async ({ jobId, updates }) => ({
        job: updateScheduledJob(jobId, updates),
      }),
    }),
    schedule_delete: tool({
      description:
        'Delete a scheduled task by id. Read schedule_list first. Existing run history is retained.',
      inputSchema: z.object({ jobId: z.string().min(1) }),
      execute: async ({ jobId }) => ({ deleted: deleteScheduledJob(jobId) }),
    }),
    schedule_run: tool({
      description:
        'Queue an immediate test run of an existing scheduled task, even if paused. Returns a pending run, not a completed result. The background worker normally starts it within one minute; use schedule_list to verify its outcome.',
      inputSchema: z.object({ jobId: z.string().min(1) }),
      execute: async ({ jobId }) => ({ run: enqueueScheduledJob(jobId) }),
    }),
    trigger_list: tool({
      description:
        'List the automation trigger rules configured on this browser (graph-event rules that fire a prompt when a matching tool call occurs). Use this to find a trigger the user is referring to before deleting it.',
      inputSchema: z.object({}),
      execute: async () => {
        const rules = listTriggerRules()
        return {
          triggers: rules.map((r) => ({
            id: r.id,
            name: r.name,
            prompt: r.prompt,
            enabled: r.enabled,
            matchCount: r.matchCount,
            lastFiredAt: r.lastFiredAt,
          })),
        }
      },
    }),

    trigger_delete: tool({
      description:
        'Delete an automation trigger rule by id. Use trigger_list first to find the id if the user refers to it by name or description.',
      inputSchema: z.object({
        triggerId: z.string().min(1),
      }),
      execute: async ({ triggerId }) => {
        const deleted = deleteTriggerRule(triggerId)
        return { deleted }
      },
    }),
  }
}
