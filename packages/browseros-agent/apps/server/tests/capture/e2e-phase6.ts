#!/usr/bin/env bun
/**
 * Phase 6 E2E smoke against a running Pane dev server + CDP browser.
 *
 * Usage:
 *   SERVER_URL=http://127.0.0.1:9716 CDP_PORT=9076 bun apps/server/tests/capture/e2e-phase6.ts
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordResearchPage } from '../../src/capture/browsing-observer'
import { setCaptureConsent } from '../../src/capture/consent'
import {
  feedCaptureChunk,
  startMeetingCapture,
  stopMeetingCapture,
} from '../../src/capture/meeting-pipeline'
import { setCapturePausedReason } from '../../src/capture/performance'
import { setPauseOnBatteryPref } from '../../src/context/battery'
import { buildContextToolSet } from '../../src/context/tools'
import { closeDb, initializeDb } from '../../src/lib/db'
import { loadHomeWidgets } from '../../src/scheduler/home'

const SERVER = process.env.SERVER_URL ?? 'http://127.0.0.1:9716'
const CDP = Number(process.env.CDP_PORT ?? '9076')

const checks: Array<{ name: string; ok: boolean; detail?: string }> = []

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `: ${detail}` : ''}`)
}

async function api(path: string, init?: RequestInit) {
  return fetch(`${SERVER}${path}`, init)
}

async function main() {
  // --- HTTP API ---
  const health = await api('/health')
  record('server health', health.ok, String(health.status))

  const statusRes = await api('/capture/status')
  record('GET /capture/status', statusRes.ok, String(statusRes.status))

  await api('/capture/consents', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain: 'meet.google.com',
      class: 'meeting',
      allowed: true,
      bucketId: 'default',
    }),
  })
  await api('/capture/consents', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain: 'example.com',
      class: 'browsing',
      allowed: true,
      bucketId: 'default',
    }),
  })
  await api('/capture/consents', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      domain: 'example.com',
      class: 'research',
      allowed: true,
      bucketId: 'default',
    }),
  })
  const consents = await api('/capture/consents')
  record('PUT/GET capture consents', consents.ok)

  // --- In-process pipeline (uses dev DB) ---
  const dir = mkdtempSync(join(tmpdir(), 'pane-phase6-e2e-'))
  process.env.BROWSEROS_DIR = dir
  process.env.BROWSEROS_ASR_MOCK = '1'
  closeDb()
  initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  setPauseOnBatteryPref(false)
  setCapturePausedReason(null)
  setCaptureConsent({
    domain: 'meet.google.com',
    class: 'meeting',
    allowed: true,
  })
  setCaptureConsent({
    domain: 'example.com',
    class: 'research',
    allowed: true,
  })

  const session = await startMeetingCapture({
    tabId: 1,
    bucketId: 'default',
    url: 'https://meet.google.com/abc-defg-hij',
    title: 'E2E Standup',
    provider: 'local-faster-whisper',
  })
  await feedCaptureChunk({
    sessionId: session.id,
    sequence: 0,
    mimeType: 'audio/webm',
    data: new TextEncoder().encode('fake-audio'),
  })
  await new Promise((r) => setTimeout(r, 300))
  const stopped = await stopMeetingCapture(session.id)
  record('meeting pipeline transcript', Boolean(stopped?.transcriptPath))

  recordResearchPage({
    url: 'https://example.com/widgets',
    title: 'Widgets',
    text: 'Widgets are reusable UI blocks for dashboards and admin tools.',
    quote: 'Widgets are reusable UI blocks',
    topic: 'widget research',
  })
  const tools = buildContextToolSet(() => 'default')
  const search = await tools.context_search?.execute?.(
    { query: 'widgets' },
    { toolCallId: 'e2e', messages: [] },
  )
  const searchText = (search as { text: string } | undefined)?.text ?? ''
  record(
    'context_search research citation',
    searchText.includes('citation:') && searchText.includes('example.com'),
  )

  const home = await loadHomeWidgets({ bucketId: 'default' })
  record(
    'home next-meeting widget',
    home.widgets.some((w) => w.type === 'next-meeting'),
  )
  record(
    'home research-thread widget',
    home.widgets.some((w) => w.type === 'research-thread'),
  )

  // --- CDP: open example.com and start capture via API with real tab id ---
  const targets = (await fetch(`http://127.0.0.1:${CDP}/json/list`).then((r) =>
    r.json(),
  )) as Array<{ id: string; type: string; url: string }>
  record(
    'CDP targets available',
    targets.length > 0,
    `${targets.length} targets`,
  )

  // Navigate a regular page via CDP eval on newtab if possible
  const webTarget = targets.find(
    (t) => t.type === 'page' && !t.url.startsWith('chrome-extension'),
  )
  if (webTarget) {
    const wsUrl = (
      await fetch(`http://127.0.0.1:${CDP}/json/version`).then((r) => r.json())
    ).webSocketDebuggerUrl.replace(/ws:\/\/[^/]+/, `ws://127.0.0.1:${CDP}`)
    const ws = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('ws failed'))
    })
    let msgId = 1
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = msgId++
        const timer = setTimeout(() => reject(new Error('cdp timeout')), 10_000)
        ws.onmessage = (ev) => {
          const data = JSON.parse(String(ev.data)) as {
            id?: number
            result?: Record<string, unknown>
            error?: { message: string }
          }
          if (data.id !== id) return
          clearTimeout(timer)
          if (data.error) reject(new Error(data.error.message))
          else resolve(data.result ?? {})
        }
        ws.send(JSON.stringify({ id, method, params }))
      })

    await send('Target.activateTarget', { targetId: webTarget.id })
    const { targetId } = (await send('Target.createTarget', {
      url: 'https://example.com/',
    })) as { targetId: string }
    await new Promise((r) => setTimeout(r, 1500))
    const tabId = Number(targetId.split('-').pop()) || 99
    const live = await api('/capture/meetings/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tabId,
        url: 'https://meet.google.com/e2e-test-room',
        title: 'E2E Live',
        bucketId: 'default',
      }),
    })
    record('POST /capture/meetings/start', live.ok, String(live.status))
    if (live.ok) {
      const json = (await live.json()) as {
        session: { id: string }
      }
      const meetingsAfterStart = (await (
        await api('/capture/meetings')
      ).json()) as {
        sessions: Array<{ id: string; status: string }>
      }
      const active = meetingsAfterStart.sessions.filter(
        (s) => s.status === 'active',
      )
      record(
        'active meeting after start',
        active.some((s) => s.id === json.session.id),
      )

      await api('/capture/chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: json.session.id,
          sequence: 0,
          mimeType: 'audio/webm',
          dataBase64: Buffer.from('fake-audio').toString('base64'),
        }),
      })
      await new Promise((r) => setTimeout(r, 800))

      await api('/capture/meetings/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: json.session.id }),
      })
      await new Promise((r) => setTimeout(r, 300))
      const transcript = await api(
        `/capture/meetings/${json.session.id}/transcript`,
      )
      if (transcript.ok) {
        const body = (await transcript.json()) as { segments: unknown[] }
        record(
          'GET meeting transcript',
          Array.isArray(body.segments) && body.segments.length > 0,
        )
      } else {
        record('GET meeting transcript', false, String(transcript.status))
      }
    }
    ws.close()
  }

  closeDb()
  const failed = checks.filter((c) => !c.ok)
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed`)
    process.exit(1)
  }
  console.log(`\nAll ${checks.length} Phase 6 E2E checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
