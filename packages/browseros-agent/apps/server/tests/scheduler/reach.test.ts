/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initializeDb } from '../../src/lib/db'
import { createEmailTransport, saveEmailConfig } from '../../src/reach/email'
import {
  reachSend,
  resetReachTransports,
  setReachTransport,
} from '../../src/reach/notify'
import {
  createOsPushTransport,
  drainOsNotificationQueue,
} from '../../src/reach/os-push'
import {
  _resetReachRateLimitsForTests,
  isInQuietHours,
  setQuietHoursConfig,
} from '../../src/reach/quiet-hours'
import { getReachSecret } from '../../src/reach/secrets'
import {
  addTelegramChatToAllowlist,
  createTelegramTransport,
  getTelegramPairingCode,
  isTelegramSenderAllowed,
  saveTelegramConfig,
} from '../../src/reach/telegram'
import type { ReachMessage, ReachTransport } from '../../src/reach/types'

describe('reach transports (M5.4)', () => {
  const tempDirs: string[] = []

  beforeEach(() => {
    drainOsNotificationQueue()
  })

  afterEach(() => {
    resetReachTransports()
    _resetReachRateLimitsForTests()
    setQuietHoursConfig({ enabled: true, startHour: 22, endHour: 8 })
    closeDb()
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    tempDirs.length = 0
  })

  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'browseros-reach-'))
    tempDirs.push(dir)
    initializeDb({ dbPath: join(dir, 'browseros.sqlite') })
  }

  it('os-push queues a notification', async () => {
    setup()
    const t = createOsPushTransport()
    await t.send({
      type: 'test',
      title: 'Hello',
      body: 'world',
    })
    const q = drainOsNotificationQueue()
    expect(q).toHaveLength(1)
    expect(q[0]?.title).toBe('Hello')
  })

  it('email stores secrets not as plaintext prefs and send uses mock', async () => {
    setup()
    saveEmailConfig({
      host: 'smtp.example.com',
      port: 587,
      user: 'u',
      password: 'secret-pass',
      from: 'a@example.com',
      to: 'b@example.com',
    })
    expect(getReachSecret('email', 'password')).toBe('secret-pass')

    const sent: ReachMessage[] = []
    const t = createEmailTransport({
      sendImpl: async (_cfg, msg) => {
        sent.push(msg)
      },
    })
    setReachTransport('email', t)
    await t.send({ type: 'test', title: 'T', body: 'B' })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.title).toContain('Pane')
  })

  it('telegram rejects unknown sender; pairing allowlists', async () => {
    setup()
    const code = saveTelegramConfig({ botToken: 'tok' })
    expect(getTelegramPairingCode()).toBe(code)
    expect(isTelegramSenderAllowed('999')).toBe(false)
    addTelegramChatToAllowlist('999')
    expect(isTelegramSenderAllowed('999')).toBe(true)

    const calls: string[] = []
    const fetchImpl = (async (url: string | URL, _init?: RequestInit) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
      })
    }) as typeof fetch

    const t = createTelegramTransport({ fetchImpl })
    await t.send({ type: 'test', title: 'Hi', body: 'there' })
    expect(calls.some((u) => u.includes('sendMessage'))).toBe(true)
  })

  it('reachSend respects quiet hours', async () => {
    setup()
    setQuietHoursConfig({ enabled: true, startHour: 0, endHour: 24 })
    // Always quiet when start=0 end=24? start < end and h >= 0 && h < 24 → always
    expect(isInQuietHours(new Date())).toBe(true)

    const mock: ReachTransport = {
      id: 'os-push',
      async isConfigured() {
        return true
      },
      async send() {
        throw new Error('should not send')
      },
    }
    setReachTransport('os-push', mock)
    const result = await reachSend({
      type: 'test',
      title: 'x',
      body: 'y',
    })
    expect(result.skipped).toContain('quiet-hours')
    expect(result.sent).toHaveLength(0)
  })
})
