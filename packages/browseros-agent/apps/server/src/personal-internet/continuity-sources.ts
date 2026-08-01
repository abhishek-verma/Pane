/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Continuity candidates from approvals (+ optional resume hints).
 */

import {
  listPendingApprovals,
  type PendingApproval,
} from '../scheduler/approvals'
import {
  findScheduledRunByConversationId,
  getScheduledRun,
} from '../scheduler/run-executor'
import type { PiContinuityBlock } from './types'

function firstPromptLine(prompt: string): string {
  const line = prompt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!line) return ''
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}

function stripPreviewPrefix(preview: string): string {
  return preview.replace(/^Needs approval:\s*/i, '').trim()
}

function approvalTitle(a: PendingApproval, source: string | undefined): string {
  if (source === 'pi-harvest')
    return 'Background harvest paused — needs approval'
  if (source === 'pi-materialize')
    return 'Background page fill paused — needs approval'
  if (source === 'trigger' || source === 'schedule' || source === 'keepalive')
    return 'Background agent paused — needs approval'
  if (a.toolName === 'act') return 'Browser click needs approval'
  if (a.toolName === 'tabs') return 'New tab needs approval'
  return 'Background agent paused — needs approval'
}

function approvalBody(
  a: PendingApproval,
  source: string | undefined,
  promptLine: string,
): string {
  const action = stripPreviewPrefix(a.preview) || a.toolName
  const lines = [`Action: ${action}`]
  if (promptLine) lines.push(`Task: ${promptLine}`)
  if (source === 'pi-harvest') {
    lines.push(
      'This is a background site harvest, not a normal chat. Open agent to see the page and decide.',
    )
  } else if (a.conversationId) {
    lines.push('Open agent to review the turn before approving.')
  } else {
    lines.push('No linked agent turn — deny if you do not recognize this.')
  }
  return lines.join('\n')
}

export function continuityFromApprovals(): PiContinuityBlock[] {
  try {
    const pending = listPendingApprovals()
    return pending.slice(0, 5).map((a) => {
      let run = a.runId ? getScheduledRun(a.runId) : null
      if (!run && a.conversationId) {
        run = findScheduledRunByConversationId(a.conversationId)
      }
      const source = run?.source
      const promptLine = run?.prompt ? firstPromptLine(run.prompt) : ''
      return {
        id: `approval-${a.id}`,
        title: approvalTitle(a, source),
        body: approvalBody(a, source, promptLine),
        // Prefer opening the live agent turn; action-log is secondary.
        route: a.conversationId ? undefined : '#/settings/action-log',
        metadata: {
          approvalId: a.id,
          toolName: a.toolName,
          kind: 'approval',
          conversationId: a.conversationId,
          approveToken: a.approveToken,
          denyToken: a.denyToken,
          source: source ?? null,
          runId: a.runId,
          expiresAt: a.expiresAt,
        },
      }
    })
  } catch {
    return []
  }
}

export function mergeContinuityBlocks(
  primary: PiContinuityBlock[],
  extras: PiContinuityBlock[],
  limit = 5,
): PiContinuityBlock[] {
  const seen = new Set(primary.map((b) => b.id))
  const out = [...primary]
  for (const e of extras) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
    if (out.length >= limit) break
  }
  return out.slice(0, limit)
}
