/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Seeds built-in skills for the in-process (model-backed) agent so the skill
 * index is not empty on a fresh install.
 */

import { getSkill, installSkillFromBody } from './store'

export const BUILTIN_MEETINGS_SKILL_ID = 'builtin-meetings'

export const BUILTIN_MEETINGS_SKILL_BODY = `---
name: meetings
description: Retrieve Pane-captured meeting transcripts and notes via capture_list / capture_read. Use for meetings, calls, standups, or "what did we discuss".
---

# Meetings

Pane records consented Meet/Zoom/Teams (and similar) calls locally. Transcripts live under the capture tools — not filesystem paths and not third-party note apps.

## When to use

- User asks about recent meetings, calls, standups, or transcripts
- User asks what was decided or said in a call

## Workflow

1. Call \`capture_list\` (newest first). Note session ids, times, and segment counts.
2. Call \`capture_read\` with \`include\` defaulting to full (or \`transcript\`) for the relevant sessionIds.
3. Summarize from the returned transcript text. Prefer a few recent sessions with segments > 0.

## Do not

- Do not use \`filesystem_read\` or \`filesystem_bash\` on \`~/.browseros/capture\` paths.
- Do not treat empty \`context_search\` as "no meetings" — list captures first.
- Do not invent meeting content when transcripts are empty or still processing.

## Optional follow-up

After transcripts are indexed, \`context_search\` can find topics inside meeting text. Still start with \`capture_list\` for "recent meetings" style asks.
`

/** Ensure built-in skills exist in the skills DB + memories/skills files. */
export async function ensureBuiltinSkills(
  options: { memoriesRoot?: string } = {},
): Promise<void> {
  const existing = getSkill(BUILTIN_MEETINGS_SKILL_ID)
  if (existing?.status === 'active') {
    // Refresh body so skill text stays current across upgrades.
    await installSkillFromBody({
      id: BUILTIN_MEETINGS_SKILL_ID,
      body: BUILTIN_MEETINGS_SKILL_BODY,
      provenance: 'imported',
      memoriesRoot: options.memoriesRoot,
    })
    return
  }
  await installSkillFromBody({
    id: BUILTIN_MEETINGS_SKILL_ID,
    body: BUILTIN_MEETINGS_SKILL_BODY,
    provenance: 'imported',
    memoriesRoot: options.memoriesRoot,
  })
}
