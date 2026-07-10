/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Daily digest assembler. Template-first (no LLM required). Writes
 * memories/digests/daily-YYYY-MM-DD.md + latest-daily.md for adaptive home.
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_BUCKET_ID } from '@browseros/context-graph/constants'
import { DIGESTS_DIR } from '@browseros/memory/constants'
import { detectOnBattery, getPauseOnBatteryPref } from '../context/battery'
import { listTasks } from '../context/tasks-repo'
import { getDbHandle } from '../lib/db'
import { logger } from '../lib/logger'
import { ensureMemoriesLayout, readPromptFiles } from '../memory/files'
import { listEntries } from '../memory/store'
import { isInQuietHours } from '../reach/quiet-hours'

const DIGEST_CHECK_INTERVAL_MS = 15 * 60 * 1000
const DEFAULT_DIGEST_HOUR = 8
const EVENT_LOOKBACK_MS = 24 * 60 * 60 * 1000
const MAX_EVENTS = 40
const MAX_MEMORY_BULLETS = 8

export interface DigestResult {
  skipped?: 'battery' | 'quiet-hours' | 'already-ran'
  path?: string
  latestPath?: string
  content?: string
}

function dateStamp(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function recentGraphEvents(sinceMs: number, limit = MAX_EVENTS) {
  const sqlite = getDbHandle().sqlite
  return sqlite
    .prepare(
      `SELECT id, tool_name, payload_json, created_at
       FROM graph_events
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<{
    id: string
    tool_name: string | null
    payload_json: string
    created_at: number
  }>
}

function parseDigestHourFromUserMd(userMd: string): number {
  const tzLine = userMd.match(/Timezone:\s*(.+)/i)
  // Hour override: "- Digest hour: 7" or "Digest hour: 7"
  const hourMatch = userMd.match(/Digest\s*hour:\s*(\d{1,2})/i)
  if (hourMatch) {
    const h = Number.parseInt(hourMatch[1]!, 10)
    if (h >= 0 && h <= 23) return h
  }
  void tzLine
  return DEFAULT_DIGEST_HOUR
}

export function assembleDailyDigestMarkdown(options?: {
  now?: number
  bucketId?: string
}): string {
  const now = options?.now ?? Date.now()
  const stamp = dateStamp(new Date(now))
  const bucketId = options?.bucketId ?? DEFAULT_BUCKET_ID
  const since = now - EVENT_LOOKBACK_MS

  const events = recentGraphEvents(since)
  const pending = [
    ...listTasks({ bucketId, status: 'inbox' }),
    ...listTasks({ bucketId, status: 'triaged' }),
  ].slice(0, 20)

  let memoryBullets: string[] = []
  try {
    memoryBullets = listEntries({
      layer: 'memory',
      status: 'active',
      limit: MAX_MEMORY_BULLETS,
    }).map((e) => e.content.split('\n')[0]!.slice(0, 160))
  } catch {
    memoryBullets = []
  }

  const lines: string[] = [
    `# Daily digest — ${stamp}`,
    '',
    `_Assembled ${new Date(now).toISOString()} (template; no LLM)._`,
    '',
    '## Pending tasks',
  ]

  if (pending.length === 0) {
    lines.push('- None')
  } else {
    for (const t of pending) {
      lines.push(`- [${t.status}] ${t.title}`)
    }
  }

  lines.push('', '## Recent activity')
  if (events.length === 0) {
    lines.push('- No graph events in the last 24h')
  } else {
    const byTool = new Map<string, number>()
    for (const e of events) {
      const key = e.tool_name ?? '(unknown)'
      byTool.set(key, (byTool.get(key) ?? 0) + 1)
    }
    for (const [tool, count] of [...byTool.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      lines.push(`- ${tool}: ${count}`)
    }
    lines.push('', '### Latest events')
    for (const e of events.slice(0, 12)) {
      const when = new Date(e.created_at).toLocaleString()
      const snippet = e.payload_json.slice(0, 120).replace(/\s+/g, ' ')
      lines.push(`- ${when} · ${e.tool_name ?? '?'} — ${snippet}`)
    }
  }

  lines.push('', '## Memory snapshot')
  if (memoryBullets.length === 0) {
    lines.push('- (empty)')
  } else {
    for (const b of memoryBullets) {
      lines.push(`- ${b}`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

export async function runDailyDigest(options?: {
  skipBatteryCheck?: boolean
  skipQuietHours?: boolean
  force?: boolean
  memoriesRoot?: string
  now?: number
  notify?: (info: { path: string; content: string }) => Promise<void>
}): Promise<DigestResult> {
  const now = options?.now ?? Date.now()

  if (!options?.skipBatteryCheck && getPauseOnBatteryPref()) {
    const onBattery = await detectOnBattery()
    if (onBattery === true) {
      return { skipped: 'battery' }
    }
  }

  if (!options?.skipQuietHours && isInQuietHours(new Date(now))) {
    return { skipped: 'quiet-hours' }
  }

  const base = await ensureMemoriesLayout(options?.memoriesRoot)
  const digestsDir = join(base, DIGESTS_DIR)
  await mkdir(digestsDir, { recursive: true })

  const stamp = dateStamp(new Date(now))
  const path = join(digestsDir, `daily-${stamp}.md`)
  const latestPath = join(digestsDir, 'latest-daily.md')

  if (!options?.force) {
    try {
      const { access } = await import('node:fs/promises')
      await access(path)
      // Same-day re-run overwrites (document: overwrite). Continue.
    } catch {
      // missing — fine
    }
  }

  const content = assembleDailyDigestMarkdown({ now })
  await writeFile(path, content, 'utf-8')
  await copyFile(path, latestPath)

  logger.info('wrote daily digest', { path })

  if (options?.notify) {
    try {
      await options.notify({ path, content })
    } catch (err) {
      logger.warn('digest notify failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    }
  } else {
    // Soft-dep on reach — no-op if not configured yet.
    try {
      const { notifyDigest } = await import('../reach/notify')
      await notifyDigest({ path, content })
    } catch {
      // reach not ready
    }
  }

  return { path, latestPath, content }
}

let digestTimer: ReturnType<typeof setInterval> | null = null
let lastDigestDay: string | null = null

export function startDailyDigestMonitor(): void {
  if (digestTimer) return
  digestTimer = setInterval(() => {
    void tickDigest().catch((err) => {
      logger.warn('daily digest tick failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }, DIGEST_CHECK_INTERVAL_MS)
  if (typeof digestTimer === 'object' && 'unref' in digestTimer) {
    digestTimer.unref()
  }
  // Also try once shortly after boot (catch-up).
  setTimeout(() => {
    void tickDigest().catch(() => {})
  }, 30_000).unref?.()
}

async function tickDigest(): Promise<void> {
  const now = new Date()
  const stamp = dateStamp(now)
  if (lastDigestDay === stamp) return

  let hour = DEFAULT_DIGEST_HOUR
  try {
    const files = await readPromptFiles()
    hour = parseDigestHourFromUserMd(files.user)
  } catch {
    // default
  }

  if (now.getHours() < hour) return

  const result = await runDailyDigest()
  if (result.path) lastDigestDay = stamp
}

/** Test helper */
export function _resetDigestMonitorForTests(): void {
  if (digestTimer) {
    clearInterval(digestTimer)
    digestTimer = null
  }
  lastDigestDay = null
}
