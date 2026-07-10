/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { saveEmailConfig } from '../../reach/email'
import { reachSend, startReachInbound } from '../../reach/notify'
import { drainOsNotificationQueue } from '../../reach/os-push'
import {
  getQuietHoursConfig,
  setQuietHoursConfig,
} from '../../reach/quiet-hours'
import {
  getTelegramPairingCode,
  saveTelegramConfig,
} from '../../reach/telegram'
import { handleApprovalInboundText } from '../../scheduler/approvals'
import type { Env } from '../types'

export function createReachRoutes() {
  // Start Telegram inbound when routes mount (best-effort).
  void startReachInbound(async (cmd) => {
    handleApprovalInboundText(cmd.text)
  }).catch(() => {})

  return new Hono<Env>()
    .get('/status', async (c) => {
      const { getReachTransport } = await import('../../reach/notify')
      const ids = ['os-push', 'email', 'telegram'] as const
      const configured: Record<string, boolean> = {}
      for (const id of ids) {
        configured[id] = await getReachTransport(id).isConfigured()
      }
      return c.json({
        configured,
        quietHours: getQuietHoursConfig(),
        pairingCode: getTelegramPairingCode(),
        osPushQueue: drainOsNotificationQueue().length,
      })
    })
    .post('/test', async (c) => {
      const body = z
        .object({
          transport: z.enum(['os-push', 'email', 'telegram']).optional(),
          message: z.string().optional(),
        })
        .parse(await c.req.json().catch(() => ({})))
      const result = await reachSend(
        {
          type: 'test',
          title: 'Pane reach test',
          body: body.message ?? 'Hello from Pane — reach is configured.',
        },
        {
          transports: body.transport ? [body.transport] : undefined,
          skipQuietHours: true,
          skipRateLimit: true,
        },
      )
      return c.json(result)
    })
    .post('/email/config', async (c) => {
      const body = z
        .object({
          host: z.string().min(1),
          port: z.number().int().positive(),
          user: z.string().min(1),
          password: z.string().min(1),
          from: z.string().min(1),
          to: z.string().min(1),
          secure: z.boolean().optional(),
        })
        .parse(await c.req.json())
      saveEmailConfig(body)
      return c.json({ ok: true })
    })
    .post('/telegram/config', async (c) => {
      const body = z
        .object({
          botToken: z.string().min(1),
          allowlist: z.array(z.string()).optional(),
        })
        .parse(await c.req.json())
      const pairingCode = saveTelegramConfig(body)
      return c.json({
        ok: true,
        pairingCode,
        hint: `In Telegram, message your bot: /pair ${pairingCode}`,
      })
    })
    .patch('/quiet-hours', async (c) => {
      const body = z
        .object({
          enabled: z.boolean().optional(),
          startHour: z.number().int().min(0).max(23).optional(),
          endHour: z.number().int().min(0).max(23).optional(),
        })
        .parse(await c.req.json())
      setQuietHoursConfig(body)
      return c.json({ quietHours: getQuietHoursConfig() })
    })
    .get('/os-push/queue', (c) =>
      c.json({ notifications: drainOsNotificationQueue() }),
    )
}
