/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * MCP tools for home widget management.
 * Follows the propose-then-confirm pattern to prevent unwanted writes.
 */

import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { getBrowserosDir } from '../lib/browseros-dir'
import { executeBinding } from './bindings'
import { BUILTIN_TEMPLATES, type WidgetSpec } from './widget-spec'
import {
  archiveWidget,
  createWidget,
  getWidgetsDir,
  listWidgets,
} from './widget-store'

const sourceSchema = z.object({
  type: z.enum([
    'tasks',
    'scheduled',
    'capture',
    'graph',
    'skills',
    'template',
  ]),
  query: z.string().optional(),
  templateId: z.string().optional(),
  bucketId: z.string().optional(),
})

const actionSchema = z.object({
  type: z.enum(['navigate', 'chat-prefill', 'run-skill', 'open-route']),
  target: z.string(),
})

export function buildHomeWidgetToolSet(): ToolSet {
  const widgetsDir = getWidgetsDir(getBrowserosDir())

  return {
    home_widget_list: tool({
      description:
        'List all home widgets (active, staged, demoted, archived). Read-only. Call before proposing to check for duplicates.',
      inputSchema: z.object({}),
      execute: async () => {
        const widgets = await listWidgets({}, widgetsDir)
        return {
          widgets: widgets.map((w) => ({
            id: w.id,
            title: w.title,
            source: w.source,
            action: w.action,
            status: w.status,
            showCount: w.showCount,
            lastActionAt: w.lastActionAt,
          })),
          availableTemplates: BUILTIN_TEMPLATES.map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description,
          })),
        }
      },
    }),

    home_widget_propose: tool({
      description:
        'Draft a home widget from user intent. Returns a preview of what data will show — does NOT write to disk. The user must confirm before calling home_widget_add. Always call home_widget_list first to avoid duplicates.',
      inputSchema: z.object({
        userIntent: z
          .string()
          .min(1)
          .describe('User\'s plain-language request, e.g. "show my open PRs"'),
        title: z.string().min(1).describe('Display title for the widget'),
        source: sourceSchema.describe('Where the widget data comes from'),
        action: actionSchema.describe('What clicking the primary button does'),
        whyText: z.string().default('').describe('Why this widget was created'),
        refreshMinutes: z.number().int().min(1).default(5),
      }),
      execute: async ({ title, source, action, whyText, refreshMinutes }) => {
        const draftSpec: WidgetSpec = {
          id: 'preview',
          title,
          source,
          action,
          refreshMinutes,
          createdBy: 'agent',
          status: 'staged',
          showCount: 0,
          lastActionAt: null,
          whyText,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        let previewItems: Array<{ label: string; sublabel?: string }> = []
        try {
          const binding = await executeBinding(draftSpec)
          previewItems = binding.items.slice(0, 3)
        } catch {
          // preview not critical
        }
        return {
          proposed: true,
          draft: {
            title,
            source,
            action,
            refreshMinutes,
            whyText,
            createdBy: 'agent',
          },
          preview: previewItems,
          message: `Widget "${title}" drafted. Ask the user to confirm, then call home_widget_add to save it.`,
          confirmationRequired: true,
        }
      },
    }),

    home_widget_add: tool({
      description:
        'Write a confirmed widget spec and add it to the home. Only call after the user has explicitly confirmed the proposal from home_widget_propose.',
      inputSchema: z.object({
        title: z.string().min(1),
        source: sourceSchema,
        action: actionSchema,
        whyText: z.string().default(''),
        refreshMinutes: z.number().int().min(1).default(5),
        createdBy: z.enum(['user', 'agent', 'system']).default('agent'),
      }),
      execute: async (input) => {
        const spec = await createWidget(input, widgetsDir)
        return {
          added: true,
          widget: { id: spec.id, title: spec.title, status: spec.status },
          message: `Widget "${spec.title}" added to your home (id: ${spec.id}).`,
        }
      },
    }),

    home_widget_remove: tool({
      description:
        'Archive (soft-delete) a home widget by id. Get the id from home_widget_list.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Widget id from home_widget_list'),
      }),
      execute: async ({ id }) => {
        await archiveWidget(id, widgetsDir)
        return {
          archived: true,
          id,
          message: `Widget ${id} archived and removed from home.`,
        }
      },
    }),
  }
}
