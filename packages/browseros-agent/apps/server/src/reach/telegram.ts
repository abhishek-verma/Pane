/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Telegram bot transport — hits api.telegram.org directly (no Pane server).
 * Pairing: one-time code; only allowlisted chat ids can command.
 */

import { logger } from '../lib/logger'
import { deleteReachSecret, getReachSecret, setReachSecret } from './secrets'
import type { ReachInbound, ReachTransport } from './types'

const TG_API = 'https://api.telegram.org'

export function saveTelegramConfig(input: {
  botToken: string
  allowlist?: string[]
}): string {
  setReachSecret('telegram', 'botToken', input.botToken)
  if (input.allowlist) {
    setReachSecret('telegram', 'allowlist', JSON.stringify(input.allowlist))
  }
  const code = String(Math.floor(100000 + Math.random() * 900000))
  setReachSecret('telegram', 'pairingCode', code)
  return code
}

export function getTelegramPairingCode(): string | null {
  return getReachSecret('telegram', 'pairingCode')
}

export function getTelegramAllowlist(): string[] {
  const raw = getReachSecret('telegram', 'allowlist')
  if (!raw) return []
  try {
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

export function addTelegramChatToAllowlist(chatId: string): void {
  const list = new Set(getTelegramAllowlist())
  list.add(chatId)
  setReachSecret('telegram', 'allowlist', JSON.stringify([...list]))
}

export function isTelegramSenderAllowed(chatId: string): boolean {
  return getTelegramAllowlist().includes(String(chatId))
}

async function tgApi(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const res = await fetchImpl(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telegram ${method} failed: ${res.status} ${text}`)
  }
  return res.json()
}

export function createTelegramTransport(options?: {
  fetchImpl?: typeof fetch
}): ReachTransport {
  const fetchImpl = options?.fetchImpl ?? fetch
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let offset = 0
  let inboundHandler: ((cmd: ReachInbound) => Promise<void>) | null = null

  return {
    id: 'telegram',
    async isConfigured() {
      return Boolean(getReachSecret('telegram', 'botToken'))
    },
    async send(msg) {
      const token = getReachSecret('telegram', 'botToken')
      if (!token) throw new Error('Telegram bot token not configured')
      const allowlist = getTelegramAllowlist()
      if (allowlist.length === 0) {
        throw new Error('No Telegram chat allowlisted — complete pairing first')
      }

      let text = `*${escapeMd(msg.title)}*\n${escapeMd(msg.body)}`
      if (msg.deepLink) text += `\n[Open in Pane](${msg.deepLink})`

      const replyMarkup =
        msg.type === 'approval' && msg.approveToken && msg.denyToken
          ? {
              inline_keyboard: [
                [
                  {
                    text: 'Approve',
                    callback_data: `approve:${msg.approveToken}`,
                  },
                  {
                    text: 'Deny',
                    callback_data: `deny:${msg.denyToken}`,
                  },
                ],
              ],
            }
          : undefined

      for (const chatId of allowlist) {
        await tgApi(
          token,
          'sendMessage',
          {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            reply_markup: replyMarkup,
          },
          fetchImpl,
        )
      }
      logger.info('telegram reach sent', {
        type: msg.type,
        chats: allowlist.length,
      })
    },
    async startInbound(handler) {
      inboundHandler = handler
      if (pollTimer) return
      pollTimer = setInterval(() => {
        void pollOnce().catch((err) => {
          logger.warn('telegram poll failed', {
            error: err instanceof Error ? err.message : String(err),
          })
        })
      }, 3000)
      if (typeof pollTimer === 'object' && 'unref' in pollTimer) {
        pollTimer.unref()
      }
    },
    async stopInbound() {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      inboundHandler = null
    },
  }

  async function pollOnce(): Promise<void> {
    const token = getReachSecret('telegram', 'botToken')
    if (!token || !inboundHandler) return
    const data = (await tgApi(
      token,
      'getUpdates',
      { offset, timeout: 0 },
      fetchImpl,
    )) as {
      ok: boolean
      result: Array<{
        update_id: number
        message?: {
          chat: { id: number }
          text?: string
          from?: { id: number }
        }
        callback_query?: {
          id: string
          data?: string
          from: { id: number }
          message?: { chat: { id: number } }
        }
      }>
    }
    for (const update of data.result ?? []) {
      offset = Math.max(offset, update.update_id + 1)
      if (update.callback_query?.data) {
        const chatId = String(
          update.callback_query.message?.chat.id ??
            update.callback_query.from.id,
        )
        if (!isTelegramSenderAllowed(chatId)) {
          logger.warn('telegram reject unknown sender', { chatId })
          continue
        }
        const [action, tokenVal] = update.callback_query.data.split(':')
        const text =
          action === 'approve' ? `/approve ${tokenVal}` : `/deny ${tokenVal}`
        await inboundHandler({
          transport: 'telegram',
          senderId: chatId,
          text,
          raw: update,
        })
        continue
      }
      const msg = update.message
      if (!msg?.text) continue
      const chatId = String(msg.chat.id)
      const pairing = getReachSecret('telegram', 'pairingCode')
      if (
        pairing &&
        msg.text.trim() === `/pair ${pairing}` &&
        !isTelegramSenderAllowed(chatId)
      ) {
        addTelegramChatToAllowlist(chatId)
        deleteReachSecret('telegram', 'pairingCode')
        await tgApi(
          token,
          'sendMessage',
          {
            chat_id: chatId,
            text: 'Paired with Pane. You can approve runs from here.',
          },
          fetchImpl,
        )
        continue
      }
      if (!isTelegramSenderAllowed(chatId)) {
        logger.warn('telegram reject unknown sender', { chatId })
        continue
      }
      await inboundHandler({
        transport: 'telegram',
        senderId: chatId,
        text: msg.text,
        raw: update,
      })
    }
  }
}

function escapeMd(s: string): string {
  return s.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}
