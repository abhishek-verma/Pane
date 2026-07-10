/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { logger } from '../lib/logger'
import { createEmailTransport } from './email'
import { createOsPushTransport } from './os-push'
import { canSendReach, isInQuietHours, recordReachSend } from './quiet-hours'
import { createTelegramTransport } from './telegram'
import type {
  ReachInbound,
  ReachMessage,
  ReachTransport,
  ReachTransportId,
} from './types'

const transports = new Map<ReachTransportId, ReachTransport>()

export function getReachTransport(id: ReachTransportId): ReachTransport {
  let t = transports.get(id)
  if (!t) {
    t =
      id === 'os-push'
        ? createOsPushTransport()
        : id === 'email'
          ? createEmailTransport()
          : createTelegramTransport()
    transports.set(id, t)
  }
  return t
}

/** Test / DI hook */
export function setReachTransport(
  id: ReachTransportId,
  transport: ReachTransport,
): void {
  transports.set(id, transport)
}

export function resetReachTransports(): void {
  transports.clear()
}

export async function reachSend(
  msg: ReachMessage,
  options?: {
    transports?: ReachTransportId[]
    skipQuietHours?: boolean
    skipRateLimit?: boolean
  },
): Promise<{ sent: ReachTransportId[]; skipped: string[] }> {
  const sent: ReachTransportId[] = []
  const skipped: string[] = []
  const ids = options?.transports ?? (['os-push', 'email', 'telegram'] as const)

  if (!options?.skipQuietHours && isInQuietHours()) {
    return { sent, skipped: ['quiet-hours'] }
  }

  for (const id of ids) {
    const t = getReachTransport(id)
    if (!(await t.isConfigured())) {
      skipped.push(`${id}:not-configured`)
      continue
    }
    if (!options?.skipRateLimit && !canSendReach(id)) {
      skipped.push(`${id}:rate-limit`)
      continue
    }
    try {
      await t.send(msg)
      recordReachSend(id)
      sent.push(id)
    } catch (err) {
      skipped.push(`${id}:${err instanceof Error ? err.message : String(err)}`)
      logger.warn('reach send failed', {
        transport: id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return { sent, skipped }
}

export async function notifyDigest(info: {
  path: string
  content: string
}): Promise<void> {
  const preview = info.content.split('\n').slice(0, 12).join('\n')
  await reachSend({
    type: 'digest',
    title: 'Daily digest',
    body: preview,
    path: info.path,
    deepLink: '#/home',
  })
}

export async function notifyApproval(msg: {
  runId: string
  toolName: string
  preview: string
  approveToken: string
  denyToken: string
}): Promise<void> {
  await reachSend({
    type: 'approval',
    title: `Approval needed: ${msg.toolName}`,
    body: msg.preview.slice(0, 1500),
    runId: msg.runId,
    approveToken: msg.approveToken,
    denyToken: msg.denyToken,
    deepLink: `#/approvals/${msg.runId}`,
  })
}

let inboundStarted = false

export async function startReachInbound(
  handler: (cmd: ReachInbound) => Promise<void>,
): Promise<void> {
  if (inboundStarted) return
  inboundStarted = true
  const tg = getReachTransport('telegram')
  if (tg.startInbound && (await tg.isConfigured())) {
    await tg.startInbound(handler)
  }
}
