/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { existsSync, readdirSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser } from '@browseros/browser-core/browser'
import { Hono } from 'hono'
import { getBrowserosDir } from '../../lib/browseros-dir'
import { getDbHandle } from '../../lib/db'
import { createKeepAliveService } from '../../scheduler/keep-alive'

interface DiagnosticsDeps {
  browser?: Browser
  port: number
  startedAt: number
}

export function createDiagnosticsRoutes(deps: DiagnosticsDeps) {
  const app = new Hono()

  app.get('/', async (c) => {
    const browserosDir = getBrowserosDir()
    const [
      serverHealth,
      cdpStatus,
      diskUsage,
      captureState,
      reachStatus,
      keepAliveStatus,
      actionLogSummary,
    ] = await Promise.all([
      getServerHealth(deps),
      getCdpStatus(deps),
      getDiskUsage(browserosDir),
      getCaptureState(browserosDir),
      getReachStatus(),
      getKeepAliveStatusData(),
      getActionLogSummary(),
    ])

    return c.json({
      serverHealth,
      cdpStatus,
      diskUsage,
      captureState,
      reachStatus,
      keepAliveStatus,
      actionLogSummary,
      dataDir: browserosDir,
    })
  })

  app.post('/test-provider', async (c) => {
    const body = await c.req.json<{ providerId: string }>()
    try {
      const res = await fetch(
        `http://127.0.0.1:${deps.port}/test-provider/${body.providerId}`,
      )
      const data = await res.json()
      return c.json({ ok: res.ok, ...data })
    } catch (e: unknown) {
      return c.json({
        ok: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      })
    }
  })

  app.post('/wipe-context-index', async (c) => {
    try {
      const { sqlite } = getDbHandle()
      sqlite.run('DELETE FROM graph_nodes')
      sqlite.run('DELETE FROM graph_edges')
      sqlite.run('DELETE FROM graph_events')
      return c.json({ ok: true })
    } catch (e: unknown) {
      return c.json(
        {
          ok: false,
          error: e instanceof Error ? e.message : 'Failed to wipe',
        },
        500,
      )
    }
  })

  app.post('/reset-onboarding', async (_c) => {
    return _c.json({
      ok: true,
      message: 'Clear local:onboardingCompleted in extension storage',
    })
  })

  app.get('/logs', async (c) => {
    const lines = parseInt(c.req.query('lines') ?? '200', 10)
    const logsDir = join(getBrowserosDir(), 'logs')
    try {
      const files = readdirSync(logsDir)
        .filter((f) => f.startsWith('pane-server-') && f.endsWith('.log'))
        .sort()
        .reverse()
      if (files.length === 0) return c.json({ lines: [] })
      const content = await readFile(join(logsDir, files[0]), 'utf-8')
      const allLines = content.split('\n')
      return c.json({ lines: allLines.slice(-lines), file: files[0] })
    } catch {
      return c.json({ lines: [], error: 'Logs directory not found' })
    }
  })

  return app
}

function getServerHealth(deps: DiagnosticsDeps) {
  return {
    running: true,
    port: deps.port,
    startedAt: new Date(deps.startedAt).toISOString(),
    uptimeMs: Date.now() - deps.startedAt,
    platform: process.platform,
    pid: process.pid,
  }
}

function getCdpStatus(deps: DiagnosticsDeps) {
  const connected = deps.browser?.isCdpConnected() ?? false
  return { connected }
}

async function getDiskUsage(browserosDir: string) {
  const result: Record<string, number> = {}
  let total = 0

  try {
    const entries = await readdir(browserosDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dirPath = join(browserosDir, entry.name)
      const size = await dirSize(dirPath)
      result[entry.name] = size
      total += size
    }
  } catch {
    return { total: 0, breakdown: {}, error: 'Could not read data directory' }
  }

  return { total, breakdown: result }
}

async function dirSize(dir: string): Promise<number> {
  let size = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isFile()) {
        const s = await stat(fullPath)
        size += s.size
      } else if (entry.isDirectory()) {
        size += await dirSize(fullPath)
      }
    }
  } catch {
    // skip unreadable dirs
  }
  return size
}

async function getCaptureState(browserosDir: string) {
  const captureDir = join(browserosDir, 'capture')
  let consents: Array<{ domain: string; meeting: boolean; browsing: boolean }> =
    []
  try {
    const { sqlite } = getDbHandle()
    const rows = sqlite
      .query(
        'SELECT domain, meeting_enabled, browsing_enabled FROM capture_consents',
      )
      .all() as Array<{
      domain: string
      meeting_enabled: number
      browsing_enabled: number
    }>
    consents = rows.map((r) => ({
      domain: r.domain,
      meeting: !!r.meeting_enabled,
      browsing: !!r.browsing_enabled,
    }))
  } catch {
    // table may not exist yet
  }

  const diskUsed = existsSync(captureDir) ? await dirSize(captureDir) : 0
  return { consents, diskUsed }
}

async function getReachStatus() {
  const transports: Array<{ type: string; configured: boolean }> = []
  try {
    const { sqlite } = getDbHandle()
    const secrets = sqlite
      .query('SELECT key FROM reach_secrets')
      .all() as Array<{ key: string }>
    const keys = secrets.map((r) => r.key)
    transports.push({ type: 'os-push', configured: true })
    transports.push({
      type: 'email',
      configured: keys.some((k) => k.startsWith('smtp')),
    })
    transports.push({
      type: 'telegram',
      configured: keys.some((k) => k.startsWith('telegram')),
    })
  } catch {
    // reach_secrets table may not exist
  }
  return { transports }
}

async function getKeepAliveStatusData() {
  try {
    const service = createKeepAliveService()
    return await service.status()
  } catch {
    return {
      platform: process.platform,
      installed: false,
      implemented: false,
    }
  }
}

async function getActionLogSummary() {
  try {
    const { sqlite } = getDbHandle()
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const rows = sqlite
      .query(
        `SELECT decision, COUNT(*) as count FROM action_log 
         WHERE created_at > ? GROUP BY decision`,
      )
      .all(sevenDaysAgo) as Array<{ decision: string; count: number }>
    const result = { approved: 0, denied: 0, replayed: 0, total: 0 }
    for (const row of rows) {
      if (row.decision === 'approved' || row.decision === 'promoted')
        result.approved += row.count
      else if (row.decision === 'denied') result.denied += row.count
      else if (row.decision === 'replayed') result.replayed += row.count
      result.total += row.count
    }
    return result
  } catch {
    return { approved: 0, denied: 0, replayed: 0, total: 0 }
  }
}
