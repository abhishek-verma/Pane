/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Post-tool context-graph ingest. Runs after successful tool settlement
 * (never instead of the trust gate). Writes are queued and flushed in
 * batches (M3.7). Incognito / private browsing and chrome:// URLs are
 * never indexed as page/tab nodes.
 */

import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { logger } from '../lib/logger'
import { graphAddEdge, graphAddEvent, graphUpsertNode } from './repo'

export interface IngestBrowserContext {
  activeTab?: { url?: string; title?: string; pageId?: number }
  isPrivate?: boolean
}

export interface IngestToolResultInput {
  bucketId: string
  runId?: string
  toolName: string
  args: Record<string, unknown>
  resultSummary: string
  browserContext?: IngestBrowserContext
  workspace?: { root: string; workspaceId?: string }
}

const BATCH_MAX_EVENTS = 50
const BATCH_FLUSH_MS = 200
const SUMMARY_CAP = 2000

type QueuedWrite = () => void

let queue: QueuedWrite[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let ingestPaused = false
let pauseReason: string | null = null

/** Test / M3.7 hook: pause non-critical ingest (e.g. on battery). */
export function setIngestPaused(paused: boolean, reason?: string): void {
  ingestPaused = paused
  pauseReason = paused ? (reason ?? 'paused') : null
}

export function isIngestPaused(): boolean {
  return ingestPaused
}

export function getIngestPauseReason(): string | null {
  return pauseReason
}

/** Flush pending writes immediately (tests / shutdown). */
export function flushIngestQueue(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const batch = queue
  queue = []
  for (const write of batch) {
    try {
      write()
    } catch (error) {
      logger.warn('context graph ingest write failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function enqueue(write: QueuedWrite): void {
  queue.push(write)
  if (queue.length >= BATCH_MAX_EVENTS) {
    flushIngestQueue()
    return
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      flushIngestQueue()
    }, BATCH_FLUSH_MS)
  }
}

function truncate(value: string, max = SUMMARY_CAP): string {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1)}…`
}

function summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (key === '__promoted') continue
    if (typeof value === 'string') {
      out[key] = truncate(value, 500)
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value == null
    ) {
      out[key] = value
    } else {
      out[key] = truncate(JSON.stringify(value), 500)
    }
  }
  return out
}

export function isInternalBrowserUrl(url: string | undefined | null): boolean {
  if (!url?.trim()) return true
  const lower = url.trim().toLowerCase()
  return (
    lower.startsWith('chrome:') ||
    lower.startsWith('chrome-extension:') ||
    lower.startsWith('about:') ||
    lower.startsWith('devtools:') ||
    lower.startsWith('edge:') ||
    lower.startsWith('brave:')
  )
}

function resolveUrl(input: IngestToolResultInput): string | undefined {
  const fromArgs =
    typeof input.args.url === 'string'
      ? input.args.url
      : typeof input.args.uri === 'string'
        ? input.args.uri
        : undefined
  return fromArgs ?? input.browserContext?.activeTab?.url
}

function resolveTitle(input: IngestToolResultInput): string | undefined {
  return (
    (typeof input.args.title === 'string' ? input.args.title : undefined) ??
    input.browserContext?.activeTab?.title
  )
}

function resolvePath(input: IngestToolResultInput): string | undefined {
  if (typeof input.args.path === 'string') return input.args.path
  if (typeof input.args.file === 'string') return input.args.file
  return undefined
}

/**
 * Map a settled tool call into graph nodes/edges/events for the active bucket.
 * Safe to call fire-and-forget; never throws to callers.
 */
export function ingestToolResult(input: IngestToolResultInput): void {
  try {
    if (ingestPaused) return
    if (input.browserContext?.isPrivate === true) return

    const bucketId = input.bucketId || DEFAULT_BUCKET_ID
    const toolName = input.toolName
    const resultSummary = truncate(input.resultSummary || '')

    enqueue(() => {
      writeIngest(bucketId, toolName, input, resultSummary)
    })
  } catch (error) {
    logger.warn('context graph ingest failed', {
      toolName: input.toolName,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function writeIngest(
  bucketId: string,
  toolName: string,
  input: IngestToolResultInput,
  resultSummary: string,
): void {
  let nodeId: string | null = null
  const url = resolveUrl(input)
  const title = resolveTitle(input)
  const path = resolvePath(input)

  if (toolName === 'navigate' || toolName === 'open') {
    if (!isInternalBrowserUrl(url) && url) {
      const page = graphUpsertNode({
        bucketId,
        kind: 'page',
        title: title ?? url,
        uri: url,
        summary: resultSummary.slice(0, 500) || null,
        provenance: `tool:${toolName}`,
        matchByUri: true,
      })
      nodeId = page.id
      const tabUri =
        input.browserContext?.activeTab?.pageId != null
          ? `tab:${input.browserContext.activeTab.pageId}`
          : `tab:${url}`
      const tab = graphUpsertNode({
        bucketId,
        kind: 'tab',
        title: title ?? url,
        uri: tabUri,
        summary: url,
        provenance: `tool:${toolName}`,
        matchByUri: true,
      })
      graphAddEdge({
        bucketId,
        fromId: tab.id,
        toId: page.id,
        kind: 'opened',
      })
    }
  } else if (
    toolName === 'snapshot' ||
    toolName === 'read' ||
    toolName === 'screenshot'
  ) {
    if (!isInternalBrowserUrl(url) && url) {
      const page = graphUpsertNode({
        bucketId,
        kind: 'page',
        title: title ?? url,
        uri: url,
        summary: resultSummary.slice(0, 500) || null,
        provenance: `tool:${toolName}`,
        matchByUri: true,
      })
      nodeId = page.id
    }
  } else if (
    toolName === 'filesystem_write' ||
    toolName === 'filesystem_edit' ||
    toolName === 'filesystem_read'
  ) {
    if (path) {
      const file = graphUpsertNode({
        bucketId,
        kind: 'file',
        title: path.split('/').pop() ?? path,
        uri: path,
        summary: resultSummary.slice(0, 500) || null,
        provenance: `tool:${toolName}`,
        matchByUri: true,
      })
      nodeId = file.id
      if (toolName !== 'filesystem_read' && input.workspace?.root) {
        const ws = graphUpsertNode({
          bucketId,
          kind: 'workspace',
          title: input.workspace.workspaceId ?? 'workspace',
          uri: input.workspace.root,
          provenance: 'system:ingest',
          matchByUri: true,
        })
        graphAddEdge({
          bucketId,
          fromId: file.id,
          toId: ws.id,
          kind: 'edited',
        })
      }
    }
  } else if (toolName === 'filesystem_bash') {
    const sessionId =
      typeof input.args.sessionId === 'string'
        ? input.args.sessionId
        : typeof input.args.session_id === 'string'
          ? input.args.session_id
          : null
    const uri = sessionId
      ? `terminal:${sessionId}`
      : `terminal:${bucketId}:${Date.now()}`
    const term = graphUpsertNode({
      bucketId,
      kind: 'terminal_session',
      title:
        typeof input.args.command === 'string'
          ? truncate(input.args.command, 120)
          : 'bash',
      uri,
      summary: resultSummary.slice(0, 500) || null,
      provenance: 'tool:filesystem_bash',
      matchByUri: true,
    })
    nodeId = term.id
  } else if (toolName === 'tabs') {
    // Light refresh only when an active tab URL is known and indexable.
    if (!isInternalBrowserUrl(url) && url) {
      graphUpsertNode({
        bucketId,
        kind: 'tab',
        title: title ?? url,
        uri:
          input.browserContext?.activeTab?.pageId != null
            ? `tab:${input.browserContext.activeTab.pageId}`
            : `tab:${url}`,
        summary: url,
        provenance: 'tool:tabs',
        matchByUri: true,
      })
    }
  }

  // Always record an event for tools we care about (thin-edge set).
  if (shouldRecordEvent(toolName)) {
    const event = graphAddEvent({
      bucketId,
      runId: input.runId ?? null,
      toolName,
      nodeId,
      payload: {
        args: summarizeArgs(input.args),
        result: truncate(resultSummary, 800),
      },
    })
    // Best-effort trigger fan-out — never fail the tool/ingest path.
    void import('../scheduler/engine')
      .then(({ onGraphEvent }) => onGraphEvent(event))
      .catch(() => {})
  }
}

function shouldRecordEvent(toolName: string): boolean {
  return (
    toolName === 'navigate' ||
    toolName === 'open' ||
    toolName === 'snapshot' ||
    toolName === 'read' ||
    toolName === 'screenshot' ||
    toolName === 'tabs' ||
    toolName === 'filesystem_write' ||
    toolName === 'filesystem_edit' ||
    toolName === 'filesystem_read' ||
    toolName === 'filesystem_bash'
  )
}

export interface TerminalIngestEvent {
  bucketId: string
  workspaceKey: string
  sessionId: string
  sessionName?: string
  cwd: string
  command: string
  exitCode: number
}

export function ingestTerminalSession(event: TerminalIngestEvent): void {
  if (ingestPaused) return
  enqueue(() => {
    const node = graphUpsertNode({
      bucketId: event.bucketId,
      kind: 'terminal_session',
      title: event.sessionName ?? event.command.slice(0, 80),
      uri: `terminal:${event.sessionId}`,
      summary: truncate(
        `$ ${event.command}\n(exit ${event.exitCode}) cwd=${event.cwd}`,
        500,
      ),
      provenance: 'tool:filesystem_bash',
      matchByUri: true,
    })
    graphAddEvent({
      bucketId: event.bucketId,
      toolName: 'filesystem_bash',
      nodeId: node.id,
      payload: {
        sessionId: event.sessionId,
        command: truncate(event.command, 500),
        exitCode: event.exitCode,
        cwd: event.cwd,
        workspaceKey: event.workspaceKey,
      },
    })
  })
}

/** Extract a short text summary from a gate/tool result for ingest. */
export function summarizeToolResult(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return truncate(result)
  if (typeof result === 'object') {
    const r = result as {
      text?: string
      isError?: boolean
      content?: Array<{ type?: string; text?: string }>
    }
    if (typeof r.text === 'string') return truncate(r.text)
    if (Array.isArray(r.content)) {
      return truncate(
        r.content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text)
          .join('\n'),
      )
    }
  }
  try {
    return truncate(JSON.stringify(result))
  } catch {
    return ''
  }
}
