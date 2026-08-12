/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { deleteTriggerRule, listTriggerRules } from '../scheduler/rules-store'

export function buildSchedulerToolSet(): ToolSet {
  return {
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
