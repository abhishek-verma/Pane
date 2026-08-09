/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Translate page failures into structured repair plans the agent can execute.
 * Prefer auto-fix when safe; otherwise give tool-level steps, not raw DSL dumps.
 */

import { validatePageDoc } from './dsl'
import type { PiNode, PiPageDoc } from './types'

export type PiRepairCode =
  | 'board_shape'
  | 'invalid_json'
  | 'mermaid_invalid'
  | 'chart_invalid'
  | 'svg_invalid'
  | 'unsafe_content'
  | 'unknown_node'
  | 'missing_title'
  | 'render_crash'
  | 'unreadable_file'
  | 'generic'

export type PiRepairFinding = {
  code: PiRepairCode
  /** auto_fixed = system already repaired; needs_agent = agent must act */
  severity: 'auto_fixed' | 'needs_agent' | 'info'
  summary: string
  /** Concrete tool steps the agent can follow. */
  agentSteps: string[]
  /** High-level approach in one line. */
  suggestedApproach: string
}

export type PiPageDiagnosis = {
  findings: PiRepairFinding[]
  /** Ready-to-read brief for the agent (no raw JSON). */
  agentBrief: string
  /** True only when the agent must inspect raw content to reconstruct meaning. */
  needsRaw: boolean
  /** Doc after safe auto-repairs, when available. */
  autoFixedDoc: PiPageDoc | null
  autoFixesApplied: string[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function classifyIssue(message: string): PiRepairCode {
  const m = message.toLowerCase()
  if (/invalid json|could not read page file|unreadable/.test(m))
    return /json/.test(m) ? 'invalid_json' : 'unreadable_file'
  if (/board|cardids|columnid/.test(m)) return 'board_shape'
  if (/mermaid/.test(m)) return 'mermaid_invalid'
  if (/chart/.test(m)) return 'chart_invalid'
  if (/svg|unsafe markup/.test(m)) return 'svg_invalid'
  if (/unsafe content|script|javascript:/.test(m)) return 'unsafe_content'
  if (/unknown node/.test(m)) return 'unknown_node'
  if (/title required/.test(m)) return 'missing_title'
  if (/cardids\.length|cannot read properties/.test(m)) return 'render_crash'
  return 'generic'
}

function findingForCode(
  code: PiRepairCode,
  detail: string,
  pageId: string,
): PiRepairFinding {
  switch (code) {
    case 'board_shape':
      return {
        code,
        severity: 'needs_agent',
        summary:
          'A board used the wrong card shape (columnId/description instead of cardIds).',
        suggestedApproach:
          'Rewrite boards to columns[].cardIds + cards[].{id,title,subtitle?}, or empty board + upsertBoardCard.',
        agentSteps: [
          `Call pi_read({ pageId: "${pageId}" }) and use diagnosis.agentBrief (raw only if needsRaw).`,
          'Load skill pi-page-patch.',
          'pi_page_patch replaceNodes with a corrected full doc, OR keep the board shell and upsertBoardCard each card with { id, title, columnId, subtitle? }.',
          'Never put columnId or description on stored cards.',
        ],
      }
    case 'mermaid_invalid':
      return {
        code,
        severity: 'needs_agent',
        summary: 'A mermaid node is missing/invalid source.',
        suggestedApproach:
          'Remove the bad mermaid node or replace it with a valid source string / a text note.',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }) for diagnosis.`,
          'pi_page_patch replaceNodes or appendNodes: drop empty mermaid, or set a valid source, or swap for type:"note".',
        ],
      }
    case 'chart_invalid':
      return {
        code,
        severity: 'needs_agent',
        summary: 'A chart node has missing or invalid data.',
        suggestedApproach:
          'Provide chart.data as [{ label, value }] or replace with a table/note.',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }).`,
          'pi_page_patch: fix chart.data or replace the node with a table/note.',
        ],
      }
    case 'svg_invalid':
      return {
        code,
        severity: 'needs_agent',
        summary: 'An svg node failed sanitize (unsafe or empty markup).',
        suggestedApproach: 'Remove the svg or replace with chart/mermaid/note.',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }).`,
          'pi_page_patch: drop the svg node or replace with a safer visual (chart/mermaid) or note.',
        ],
      }
    case 'invalid_json':
      return {
        code,
        severity: 'needs_agent',
        summary: 'The page file is not valid JSON.',
        suggestedApproach:
          'Rewrite the page from scratch with replaceNodes (full valid doc).',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }) — raw may be unavailable.`,
          'Load pi-page-dsl.',
          `pi_page_patch({ pageId: "${pageId}", ops: [{ op: "replaceNodes", nodes: [/* valid PiNode[] */] }] }) with setTitle if needed.`,
          'Prefer a simple title + text/board shell; re-add detail afterward.',
        ],
      }
    case 'unreadable_file':
      return {
        code,
        severity: 'needs_agent',
        summary: 'The page file could not be read from disk.',
        suggestedApproach: 'Recreate the page content with replaceNodes.',
        agentSteps: [
          `pi_page_patch replaceNodes with a minimal valid doc for pageId=${pageId}.`,
        ],
      }
    case 'unsafe_content':
      return {
        code,
        severity: 'needs_agent',
        summary:
          'Content failed safety checks (script / javascript: / handlers).',
        suggestedApproach:
          'Rewrite text without HTML/script; use plain strings.',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }).`,
          'pi_page_patch: replace offending text/nodes with plain content.',
        ],
      }
    case 'unknown_node':
      return {
        code,
        severity: 'needs_agent',
        summary: 'The page contains an unknown node type.',
        suggestedApproach:
          'Remove unknown nodes or map them to a supported type.',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }).`,
          'pi_page_patch replaceNodes without unknown types (see pi-page-dsl element table).',
        ],
      }
    case 'missing_title':
      return {
        code,
        severity: 'needs_agent',
        summary: 'Page title is missing.',
        suggestedApproach: 'setTitle to a non-empty string.',
        agentSteps: [
          `pi_page_patch({ pageId: "${pageId}", ops: [{ op: "setTitle", title: "…" }] }).`,
        ],
      }
    case 'render_crash':
      return {
        code,
        severity: 'needs_agent',
        summary: `UI crashed while rendering: ${detail}`,
        suggestedApproach:
          'Usually a board/chart/mermaid shape bug, or stale text in a specific node — read diagnosis, then patch the smallest thing that is wrong.',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }) and follow diagnosis.agentBrief.`,
          'If a board is mentioned, fix with cardIds/upsertBoardCard.',
          'If only one text/note/title/badge node is wrong, use setNodeText { id, text } — cheaper and safer than rewriting the page.',
          'If a viz node is mentioned, remove or repair that node.',
          'pi_page_patch replaceNodes only when the page will not load at all and no targeted op can fix it.',
        ],
      }
    default:
      return {
        code: 'generic',
        severity: 'needs_agent',
        summary: detail || 'Page failed validation.',
        suggestedApproach:
          'Read diagnosis via pi_read, then apply the smallest targeted fix — setNodeText for a single node, upsertBoardCard/setCell for board or table content, replaceNodes only as a last resort.',
        agentSteps: [
          `pi_read({ pageId: "${pageId}" }).`,
          'Load pi-page-dsl / pi-page-patch.',
          'Apply the suggestedApproach from each finding, preferring setNodeText/upsertBoardCard/setCell over replaceNodes, then verify with pi_read again.',
        ],
      }
  }
}

/** Best-effort safe auto-repair: coerce boards, drop empty mermaid/chart/svg, fill missing title. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential node heal passes
export function tryAutoRepairPage(
  raw: unknown,
  fallbackTitle: string,
): { doc: PiPageDoc; fixes: string[] } | null {
  const fixes: string[] = []
  if (!isRecord(raw)) return null

  const next: Record<string, unknown> = structuredClone(raw)
  if (typeof next.title !== 'string' || !next.title.trim()) {
    next.title = fallbackTitle || 'Page'
    fixes.push('Filled missing title')
  }
  if (next.version !== 1) {
    next.version = 1
    fixes.push('Set version to 1')
  }
  if (!Array.isArray(next.nodes)) {
    next.nodes = []
    fixes.push('Replaced missing nodes with []')
  }

  const nodes = next.nodes as unknown[]
  const cleaned: unknown[] = []
  for (const node of nodes) {
    if (!isRecord(node) || typeof node.type !== 'string') {
      fixes.push('Dropped non-object node')
      continue
    }
    if (node.type === 'mermaid') {
      if (typeof node.source !== 'string' || !node.source.trim()) {
        cleaned.push({
          type: 'note',
          text: 'Diagram removed (invalid mermaid source).',
        })
        fixes.push('Replaced empty mermaid with note')
        continue
      }
    }
    if (node.type === 'chart') {
      if (!Array.isArray(node.data) || node.data.length === 0) {
        cleaned.push({
          type: 'note',
          text: 'Chart removed (missing data).',
        })
        fixes.push('Replaced empty chart with note')
        continue
      }
    }
    if (node.type === 'svg') {
      if (typeof node.markup !== 'string' || !node.markup.trim()) {
        cleaned.push({
          type: 'note',
          text: 'Illustration removed (invalid svg).',
        })
        fixes.push('Replaced empty svg with note')
        continue
      }
    }
    // Board: leave for validatePageDoc coerceBoards
    if (node.type === 'board') {
      const cards = Array.isArray(node.cards) ? node.cards : []
      const agentShaped = cards.some(
        (c) =>
          isRecord(c) &&
          (typeof c.columnId === 'string' ||
            typeof c.id !== 'string' ||
            (c.description != null && c.subtitle == null)),
      )
      const missingCardIds =
        Array.isArray(node.columns) &&
        node.columns.some((c) => isRecord(c) && !Array.isArray(c.cardIds))
      if (agentShaped || missingCardIds) {
        fixes.push('Will coerce board to cardIds shape')
      }
    }
    cleaned.push(node)
  }
  next.nodes = cleaned

  try {
    const doc = validatePageDoc(next, { coerceBoards: true })
    // Confirm boards look right
    for (const n of doc.nodes) {
      if (n.type === 'board') {
        for (const col of n.columns) {
          if (!Array.isArray(col.cardIds)) {
            return null
          }
        }
      }
    }
    return { doc, fixes }
  } catch {
    return null
  }
}

export function buildPageDiagnosis(input: {
  pageId: string
  issues: string[]
  raw: unknown | null
  renderError?: string
  fallbackTitle?: string
}): PiPageDiagnosis {
  const findings: PiRepairFinding[] = []
  const autoFixesApplied: string[] = []
  let autoFixedDoc: PiPageDoc | null = null

  if (input.renderError) {
    findings.push(
      findingForCode('render_crash', input.renderError, input.pageId),
    )
  }

  for (const issue of input.issues) {
    // Coerce-on-read notes are info after auto-repair, not agent work.
    if (/^Coerced on read:/i.test(issue)) {
      findings.push({
        code: 'board_shape',
        severity: 'info',
        summary:
          'Board shape was coerced on read. Prefer writing cardIds + card.id next time.',
        suggestedApproach:
          'No action required unless the UI still looks wrong.',
        agentSteps: [
          'If the page still looks wrong, call pi_read and follow remaining needs_agent findings.',
        ],
      })
      continue
    }
    const code = classifyIssue(issue)
    findings.push(findingForCode(code, issue, input.pageId))
  }

  if (input.raw != null) {
    const repaired = tryAutoRepairPage(input.raw, input.fallbackTitle || 'Page')
    if (repaired) {
      autoFixedDoc = repaired.doc
      autoFixesApplied.push(...repaired.fixes)
      // Downgrade board_shape / mermaid / chart findings that we fixed.
      for (const f of findings) {
        if (
          f.severity === 'needs_agent' &&
          (f.code === 'board_shape' ||
            f.code === 'mermaid_invalid' ||
            f.code === 'chart_invalid' ||
            f.code === 'svg_invalid' ||
            f.code === 'missing_title' ||
            f.code === 'render_crash')
        ) {
          f.severity = 'auto_fixed'
          f.summary = `${f.summary} (auto-repaired by system)`
          f.agentSteps = [
            'No action required — system already wrote a valid doc. Optionally pi_read to verify.',
          ]
          f.suggestedApproach = 'Already fixed automatically.'
        }
      }
    }
  }

  if (findings.length === 0) {
    findings.push({
      code: 'generic',
      severity: 'info',
      summary: 'No structural issues detected.',
      suggestedApproach: 'Nothing to repair.',
      agentSteps: [],
    })
  }

  const needsAgent = findings.filter((f) => f.severity === 'needs_agent')
  const needsRaw = needsAgent.some(
    (f) =>
      f.code === 'invalid_json' ||
      f.code === 'generic' ||
      f.code === 'unknown_node' ||
      f.code === 'unsafe_content',
  )

  const agentBrief = [
    needsAgent.length === 0
      ? 'System handled repair automatically (or nothing to do). Verify with pi_read if useful.'
      : `Page ${input.pageId} needs agent repair (${needsAgent.length} finding(s)).`,
    ...needsAgent.map(
      (f, i) =>
        `${i + 1}. [${f.code}] ${f.summary}\n   Approach: ${f.suggestedApproach}\n   Steps:\n${f.agentSteps.map((s) => `   - ${s}`).join('\n')}`,
    ),
    autoFixesApplied.length
      ? `Auto-fixes already applied: ${autoFixesApplied.join('; ')}.`
      : null,
    needsRaw
      ? 'Raw JSON is available via pi_read when you need content to reconstruct meaning.'
      : 'You do not need the raw file — follow the steps above with pi_page_patch.',
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    findings,
    agentBrief,
    needsRaw,
    autoFixedDoc,
    autoFixesApplied,
  }
}

/** Summarize nodes for agent context without dumping full raw JSON. */
export function summarizeRawPage(raw: unknown): {
  title?: string
  nodeTypes: string[]
  boardSummaries: Array<{
    columns: string[]
    cardTitles: string[]
    shape: 'ok' | 'agent_shaped'
  }>
} {
  if (!isRecord(raw)) return { nodeTypes: [], boardSummaries: [] }
  const title = typeof raw.title === 'string' ? raw.title : undefined
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : []
  const nodeTypes: string[] = []
  const boardSummaries: Array<{
    columns: string[]
    cardTitles: string[]
    shape: 'ok' | 'agent_shaped'
  }> = []

  const walk = (n: unknown) => {
    if (!isRecord(n) || typeof n.type !== 'string') return
    nodeTypes.push(n.type)
    if (n.type === 'board') {
      const columns = Array.isArray(n.columns)
        ? n.columns.map((c) =>
            isRecord(c) && typeof c.title === 'string' ? c.title : '?',
          )
        : []
      const cards = Array.isArray(n.cards) ? n.cards : []
      const cardTitles = cards.map((c) =>
        isRecord(c) && typeof c.title === 'string' ? c.title : '?',
      )
      const agentShaped = cards.some(
        (c) =>
          isRecord(c) &&
          (typeof c.columnId === 'string' || typeof c.id !== 'string'),
      )
      boardSummaries.push({
        columns,
        cardTitles,
        shape: agentShaped ? 'agent_shaped' : 'ok',
      })
    }
    if (n.type === 'stack' && Array.isArray(n.children)) {
      for (const c of n.children) walk(c)
    }
  }
  for (const n of nodes) walk(n)

  return { title, nodeTypes, boardSummaries }
}

export function assertValidNodes(nodes: PiNode[]): void {
  // Exported for tests / future use
  void nodes
}

function truncateForRender(text: string, max = 70): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** One-line plain-English description of a node, matching what the user sees on screen. */
function describeNodeRender(node: PiNode, depth: number): string {
  const indent = '  '.repeat(depth)
  switch (node.type) {
    case 'title':
      return `${indent}Heading: "${truncateForRender(node.text)}"`
    case 'text':
      return `${indent}Paragraph: "${truncateForRender(node.text)}"`
    case 'note':
      return `${indent}Callout: "${truncateForRender(node.text)}"`
    case 'badge':
      return `${indent}Badge (${node.tone ?? 'neutral'}): "${truncateForRender(node.text)}"`
    case 'stat':
      return `${indent}Stat: ${node.label} = ${node.value}`
    case 'divider':
      return `${indent}Divider`
    case 'stack': {
      const label = node.columns
        ? `${node.columns}-column section`
        : node.direction === 'row'
          ? 'Row group'
          : 'Section'
      return [
        `${indent}${label}:`,
        ...node.children.map((c) => describeNodeRender(c, depth + 1)),
      ].join('\n')
    }
    case 'button':
      return `${indent}Button: "${node.label}"`
    case 'link':
      return `${indent}Link: "${node.label}"`
    case 'table': {
      const headers = node.columns.map((c) => c.header).join(', ')
      return `${indent}Table [${headers}] — ${node.rows.length} row(s)`
    }
    case 'board': {
      const cols = node.columns
        .map((c) => `${c.title} (${c.cardIds.length})`)
        .join(', ')
      return `${indent}Board — columns: ${cols || '(none)'}; ${node.cards.length} card(s) total`
    }
    case 'chart':
      return `${indent}Chart (${node.chartType})${node.title ? ` "${node.title}"` : ''} — ${node.data.length} data point(s)`
    case 'mermaid':
      return `${indent}Diagram${node.title ? ` "${node.title}"` : ''} (Mermaid)`
    case 'svg':
      return `${indent}Custom illustration${node.title ? ` "${node.title}"` : ''}`
    default:
      return `${indent}(unrecognized node)`
  }
}

/**
 * Plain-English outline of how a page doc will render, top to bottom — the
 * same shape the user sees, not the JSON tree. Use to sanity-check a create/
 * patch result instead of re-reading raw nodes, and to spot an empty-looking
 * page (e.g. a board with no cards) before telling the user it's ready.
 */
export function describePageRender(doc: {
  title: string
  nodes: PiNode[]
}): string {
  if (doc.nodes.length === 0) {
    return `Page: "${doc.title}"\n(empty — no content nodes yet)`
  }
  return [
    `Page: "${doc.title}"`,
    ...doc.nodes.map((n) => describeNodeRender(n, 0)),
  ].join('\n')
}
