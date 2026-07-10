/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * SMTP outbound via Bun/Node net sockets is heavy; we use a thin fetch-free
 * SMTP client over TCP for AUTH LOGIN. IMAP inbound is optional/partial —
 * Telegram covers approve/deny inbound for v0.5.
 */

import { connect } from 'node:net'
import { logger } from '../lib/logger'
import { getReachSecret, setReachSecret } from './secrets'
import type { ReachMessage, ReachTransport } from './types'

export interface EmailConfig {
  host: string
  port: number
  user: string
  password: string
  from: string
  to: string
  secure?: boolean
}

export function saveEmailConfig(config: EmailConfig): void {
  setReachSecret('email', 'host', config.host)
  setReachSecret('email', 'port', String(config.port))
  setReachSecret('email', 'user', config.user)
  setReachSecret('email', 'password', config.password)
  setReachSecret('email', 'from', config.from)
  setReachSecret('email', 'to', config.to)
  setReachSecret('email', 'secure', config.secure ? '1' : '0')
}

export function loadEmailConfig(): EmailConfig | null {
  const host = getReachSecret('email', 'host')
  const port = getReachSecret('email', 'port')
  const user = getReachSecret('email', 'user')
  const password = getReachSecret('email', 'password')
  const from = getReachSecret('email', 'from')
  const to = getReachSecret('email', 'to')
  if (!host || !port || !user || !password || !from || !to) return null
  return {
    host,
    port: Number.parseInt(port, 10),
    user,
    password,
    from,
    to,
    secure: getReachSecret('email', 'secure') === '1',
  }
}

async function smtpSend(
  config: EmailConfig,
  subject: string,
  body: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host: config.host, port: config.port }, () => {
      // proceed via line protocol below
    })
    let buffer = ''
    let step = 0
    const lines = [
      `EHLO localhost\r\n`,
      `AUTH LOGIN\r\n`,
      `${Buffer.from(config.user).toString('base64')}\r\n`,
      `${Buffer.from(config.password).toString('base64')}\r\n`,
      `MAIL FROM:<${config.from}>\r\n`,
      `RCPT TO:<${config.to}>\r\n`,
      `DATA\r\n`,
      `From: ${config.from}\r\nTo: ${config.to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`,
      `QUIT\r\n`,
    ]

    const fail = (err: Error) => {
      socket.destroy()
      reject(err)
    }

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8')
      while (buffer.includes('\r\n')) {
        const idx = buffer.indexOf('\r\n')
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const code = Number.parseInt(line.slice(0, 3), 10)
        if (Number.isNaN(code)) continue
        // Multi-line replies end when the 4th char is space.
        if (line.length >= 4 && line[3] === '-') continue
        if (code >= 400) {
          fail(new Error(`SMTP error: ${line}`))
          return
        }
        if (step < lines.length) {
          socket.write(lines[step]!)
          step += 1
        }
        if (step >= lines.length && code === 221) {
          socket.end()
          resolve()
        }
      }
    })
    socket.on('error', fail)
    socket.setTimeout(20_000, () => fail(new Error('SMTP timeout')))
  })
}

export function createEmailTransport(options?: {
  sendImpl?: (config: EmailConfig, msg: ReachMessage) => Promise<void>
}): ReachTransport {
  return {
    id: 'email',
    async isConfigured() {
      return loadEmailConfig() != null
    },
    async send(msg) {
      const config = loadEmailConfig()
      if (!config) throw new Error('Email transport not configured')
      const subject = `[Pane] ${msg.title}`
      let body = msg.body
      if (msg.type === 'approval' && msg.approveToken && msg.denyToken) {
        body += `\n\nReply APPROVE ${msg.approveToken} or DENY ${msg.denyToken}`
      }
      if (msg.deepLink) body += `\n\nOpen in Pane: ${msg.deepLink}`
      if (options?.sendImpl) {
        await options.sendImpl(config, { ...msg, body, title: subject })
        return
      }
      await smtpSend(config, subject, body)
      logger.info('email reach sent', { to: config.to, type: msg.type })
    },
  }
}
