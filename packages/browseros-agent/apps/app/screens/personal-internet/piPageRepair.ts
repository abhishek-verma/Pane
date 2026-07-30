/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { PiAction } from './types'

export type PiRepairFindingClient = {
  code: string
  severity: string
  summary: string
  agentSteps?: string[]
  suggestedApproach?: string
}

export type PiPageRepairOpts = {
  siteId: string
  pageId: string
  pageTitle?: string
  entityKey?: string
  /** Prefer structured diagnosis over raw issue strings. */
  agentBrief?: string
  findings?: PiRepairFindingClient[]
  contentSummary?: {
    title?: string
    nodeTypes?: string[]
    boardSummaries?: Array<{
      columns: string[]
      cardTitles: string[]
      shape: string
    }>
  }
  /** Legacy / fallback raw validator messages. */
  issues?: string[]
  fixHint?: string
  renderError?: string
}

/** Agent action: system diagnosis first; agent executes tool steps. */
export function buildPiPageRepairAction(opts: PiPageRepairOpts): PiAction {
  const subject = opts.pageTitle || opts.entityKey || opts.pageId
  const returnRoute = opts.entityKey
    ? `/pi/sites/${opts.siteId}/entities/${encodeURIComponent(opts.entityKey)}`
    : `/pi/sites/${opts.siteId}/pages/${opts.pageId}`

  const needsAgentFindings = (opts.findings ?? []).filter(
    (f) => f.severity === 'needs_agent',
  )

  const brief =
    opts.agentBrief?.trim() ||
    (needsAgentFindings.length
      ? needsAgentFindings
          .map(
            (f, i) =>
              `${i + 1}. [${f.code}] ${f.summary}\n   ${f.suggestedApproach ?? ''}\n${(f.agentSteps ?? []).map((s) => `   - ${s}`).join('\n')}`,
          )
          .join('\n')
      : null)

  const query = [
    `Repair the Personal Internet page "${subject}".`,
    `siteId=${opts.siteId} pageId=${opts.pageId}.`,
    opts.entityKey ? `Entity key: ${opts.entityKey}.` : null,
    opts.renderError ? `UI render error: ${opts.renderError}` : null,
    '',
    'The system already classified the failure. Do NOT reverse-engineer raw validator strings.',
    brief
      ? `Diagnosis / plan:\n${brief}`
      : `Call pi_read({ pageId: "${opts.pageId}" }) and follow diagnosis.agentBrief.`,
    opts.contentSummary
      ? `Content summary (not raw JSON): ${JSON.stringify(opts.contentSummary)}`
      : null,
    '',
    'Execute the steps with pi_page_patch (and skills pi-page-dsl / pi-page-patch).',
    'Only request/use raw from pi_read when diagnosis.needsRaw is true.',
    'Do not rematerialize or call ensure with force.',
  ]
    .filter((line) => line !== null)
    .join('\n')

  return {
    kind: 'agent',
    query,
    metadata: {
      returnRoute,
      siteId: opts.siteId,
      pageId: opts.pageId,
      intent: 'pi-page-repair',
      ...(opts.agentBrief ? { agentBrief: opts.agentBrief } : {}),
      ...(opts.findings ? { findings: opts.findings } : {}),
      ...(opts.contentSummary ? { contentSummary: opts.contentSummary } : {}),
      ...(opts.entityKey ? { entityKey: opts.entityKey } : {}),
      ...(opts.pageTitle ? { pageTitle: opts.pageTitle } : {}),
      ...(opts.renderError ? { renderError: opts.renderError } : {}),
    },
  }
}
