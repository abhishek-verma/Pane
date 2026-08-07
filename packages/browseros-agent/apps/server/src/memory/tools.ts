/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { PROMOTED_ARG } from '@browseros/shared/trust/consequence-class'
import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { writePromptFileAndReindex } from './files'
import { PromptBudgetExceededError } from './prompt-budget'
import { noteSkillLoaded } from './skill-outcomes'
import {
  archiveSkill,
  checkMemoryAddBudget,
  installSkillFromSource,
  loadSkill,
  SkillFetchError,
} from './skills'
import {
  forgetMemoryEntry,
  listEntries,
  listSkills,
  MemoryWriteRejectedError,
  recordSkillOutcome,
  writeMemoryEntry,
} from './store'

const promotedField = {
  [PROMOTED_ARG]: z.boolean().optional(),
} as const

export function buildMemoryToolSet(
  getBucketId: () => string,
  getRunId?: () => string | undefined,
): ToolSet {
  return {
    memory_add: tool({
      description:
        'Add a durable note to MEMORY.md (conversation/user derived). Fails loudly if over prompt budget.',
      inputSchema: z.object({
        content: z.string().min(1),
        bucketId: z.string().optional(),
        ...promotedField,
      }),
      execute: async ({ content, bucketId }) => {
        try {
          checkMemoryAddBudget(content)
          const entry = await writeMemoryEntry({
            content,
            source: 'conversation',
            bucketId: bucketId || getBucketId(),
          })
          return { text: `Remembered (${entry.id}): ${entry.content}` }
        } catch (err) {
          if (
            err instanceof MemoryWriteRejectedError ||
            err instanceof PromptBudgetExceededError
          ) {
            return { text: err.message, isError: true }
          }
          throw err
        }
      },
    }),
    memory_replace: tool({
      description:
        'Replace memory entries matching a substring with new content.',
      inputSchema: z.object({
        match: z.string().min(1),
        content: z.string().min(1),
        bucketId: z.string().optional(),
        ...promotedField,
      }),
      execute: async ({ match, content, bucketId }) => {
        const id = bucketId || getBucketId()
        await forgetMemoryEntry(match, { bucketId: id })
        try {
          checkMemoryAddBudget(content)
          const entry = await writeMemoryEntry({
            content,
            source: 'conversation',
            bucketId: id,
          })
          return { text: `Replaced with (${entry.id}): ${entry.content}` }
        } catch (err) {
          if (
            err instanceof MemoryWriteRejectedError ||
            err instanceof PromptBudgetExceededError
          ) {
            return { text: err.message, isError: true }
          }
          throw err
        }
      },
    }),
    memory_remove: tool({
      description: 'Forget memory entries matching a substring.',
      inputSchema: z.object({
        match: z.string().min(1),
        bucketId: z.string().optional(),
        ...promotedField,
      }),
      execute: async ({ match, bucketId }) => {
        const result = await forgetMemoryEntry(match, {
          bucketId: bucketId || getBucketId(),
        })
        if (!result.removed) {
          return { text: `No memory matched "${match}".` }
        }
        return {
          text: `Forgot ${result.entryIds.length || 1} entr(y/ies) matching "${match}".`,
        }
      },
    }),
    soul_edit: tool({
      description:
        'Replace SOUL.md (persona/voice/boundaries) with new full content. Requires user confirmation before saving.',
      inputSchema: z.object({
        content: z.string().min(1),
        ...promotedField,
      }),
      execute: async ({ content }) => {
        await writePromptFileAndReindex('soul', content)
        return { text: 'Updated SOUL.md.' }
      },
    }),
    user_edit: tool({
      description:
        'Replace USER.md (durable user profile/preferences) with new full content. Requires user confirmation before saving.',
      inputSchema: z.object({
        content: z.string().min(1),
        ...promotedField,
      }),
      execute: async ({ content }) => {
        await writePromptFileAndReindex('user', content)
        return { text: 'Updated USER.md.' }
      },
    }),
    skills_list: tool({
      description:
        'List active skills (name + one-liner). Bodies via skills_load.',
      inputSchema: z.object({
        bucketId: z.string().optional(),
      }),
      execute: async ({ bucketId }) => {
        const skills = listSkills({
          bucketId: bucketId || getBucketId(),
          status: 'active',
        })
        if (skills.length === 0) return { text: 'No active skills.' }
        return {
          text: skills
            .map((s) => `- ${s.name} (id=${s.id}): ${s.description}`)
            .join('\n'),
        }
      },
    }),
    skills_load: tool({
      description:
        'Load a full SKILL.md body by skill id or name. Prefer skills_list first.',
      inputSchema: z.object({
        id: z.string().min(1).describe('Skill id or name from skills_list'),
      }),
      execute: async ({ id }) => {
        const loaded = await loadSkill(id)
        if (!loaded) return { text: `Skill not found: ${id}`, isError: true }
        const runId = getRunId?.()
        if (runId) {
          noteSkillLoaded(runId, loaded.id)
        } else {
          // MCP / one-shot: no run lifecycle — count as successful use.
          recordSkillOutcome(loaded.id, true)
        }
        return { text: loaded.body }
      },
    }),
    skills_install: tool({
      description:
        'Install a skill from a local SKILL.md path or https URL (agentskills.io). Provide path XOR url.',
      inputSchema: z
        .object({
          path: z.string().min(1).optional(),
          url: z.string().url().optional(),
          id: z.string().optional(),
          bucketId: z.string().optional(),
          ...promotedField,
        })
        .refine((v) => Boolean(v.path) !== Boolean(v.url), {
          message: 'Provide exactly one of path or url',
        }),
      execute: async ({ path, url, id, bucketId }) => {
        try {
          const installedId = await installSkillFromSource(
            { path, url },
            {
              id,
              bucketId: bucketId || getBucketId(),
            },
          )
          return { text: `Installed skill: ${installedId}` }
        } catch (err) {
          const message =
            err instanceof SkillFetchError || err instanceof Error
              ? err.message
              : String(err)
          return { text: message, isError: true }
        }
      },
    }),
    skills_archive: tool({
      description: 'Archive a skill (removes from active index).',
      inputSchema: z.object({
        id: z.string().min(1),
        ...promotedField,
      }),
      execute: async ({ id }) => {
        const skill = listSkills({
          status: ['active', 'flagged', 'staged'],
        }).find((s) => s.id === id || s.name === id)
        if (!skill) return { text: `Skill not found: ${id}`, isError: true }
        await archiveSkill(skill.id)
        return { text: `Archived skill: ${skill.id}` }
      },
    }),
  }
}

/** Debug helper for tests — list entries without a tool. */
export function debugListMemory(bucketId = 'default') {
  return listEntries({ bucketId })
}

export { finalizeSkillOutcomesForRun } from './skill-outcomes'
