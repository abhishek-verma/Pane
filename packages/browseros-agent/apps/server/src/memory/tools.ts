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
  removeSkill,
  SkillFetchError,
  SkillNotDeletableError,
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
        "Replace SOUL.md (your persona: voice, boundaries, operating style) with new full content — this is the same file shown in Settings > Memory & Skills, and takes effect for the rest of this conversation once approved. Read the current <soul> content first and edit it, don't discard it. Use when the user explicitly asks you to behave differently, or you notice a stable, repeated correction to your tone/behavior. Requires user confirmation before saving.",
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
        "Replace USER.md (durable user profile: name, role, timezone, preferences) with new full content — this is the same file shown in Settings > Memory & Skills, and takes effect for the rest of this conversation once approved. Read the current <user_profile> content first and edit it, don't discard it. Building this file out is a standing goal, especially early on: when <user_profile> still has unknown/placeholder fields, fill them in as soon as you learn the real value from something the user says, rather than waiting to be asked. Requires user confirmation before saving.",
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
        'Add or update a skill: from a local SKILL.md path, an https URL (agentskills.io), or by authoring one yourself with a full SKILL.md body (YAML frontmatter name/description, then Markdown instructions). Provide exactly one of path, url, or body. Use body — not path/url — to turn a workflow you just did for the user into something reusable next time, without waiting to be asked: when you notice yourself repeating the same multi-step workflow in a way that generalizes (not a one-off task), draft it and call this. To fix or improve an existing skill instead of creating a near-duplicate, call skills_list to get its exact id, then call this again with body + that same id — it overwrites the skill in place. Goes live immediately in the skill index once approved.',
      inputSchema: z
        .object({
          path: z.string().min(1).optional(),
          url: z.string().url().optional(),
          body: z
            .string()
            .min(1)
            .optional()
            .describe(
              'Full SKILL.md content to author directly, starting with --- frontmatter',
            ),
          id: z
            .string()
            .optional()
            .describe(
              'kebab-case id. Derived from the frontmatter name if omitted. Pass an existing skill id (from skills_list) with body to update that skill in place instead of creating a new one.',
            ),
          bucketId: z.string().optional(),
          ...promotedField,
        })
        .refine((v) => [v.path, v.url, v.body].filter(Boolean).length === 1, {
          message: 'Provide exactly one of path, url, or body',
        }),
      execute: async ({ path, url, body, id, bucketId }) => {
        try {
          const installedId = await installSkillFromSource(
            { path, url, body },
            {
              id,
              bucketId: bucketId || getBucketId(),
            },
          )
          return { text: `Installed skill: ${installedId}` }
        } catch (err) {
          const message =
            err instanceof MemoryWriteRejectedError ||
            err instanceof SkillFetchError ||
            err instanceof Error
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
    skills_delete: tool({
      description:
        'Permanently delete a skill (files + index entry) by id or name. Only for skills you or the user created — never a built-in skill, which cannot be deleted (archive it instead). Use when the user asks to remove a skill, or you created one that was a mistake or duplicate.',
      inputSchema: z.object({
        id: z.string().min(1),
        ...promotedField,
      }),
      execute: async ({ id }) => {
        const skill = listSkills({
          status: ['active', 'flagged', 'staged', 'archived'],
        }).find((s) => s.id === id || s.name === id)
        if (!skill) return { text: `Skill not found: ${id}`, isError: true }
        try {
          await removeSkill(skill.id)
          return { text: `Deleted skill: ${skill.id}` }
        } catch (err) {
          const message =
            err instanceof SkillNotDeletableError || err instanceof Error
              ? err.message
              : String(err)
          return { text: message, isError: true }
        }
      },
    }),
  }
}

/** Debug helper for tests — list entries without a tool. */
export function debugListMemory(bucketId = 'default') {
  return listEntries({ bucketId })
}

export { finalizeSkillOutcomesForRun } from './skill-outcomes'
