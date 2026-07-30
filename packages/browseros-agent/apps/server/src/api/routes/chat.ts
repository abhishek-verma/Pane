/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { Browser } from '@browseros/browser-core/browser'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { zValidator } from '@hono/zod-validator'
import type { UIMessage } from 'ai'
import { Hono } from 'hono'
import { z } from 'zod'
import type { SessionStore } from '../../agent/session-store'
import { logger } from '../../lib/logger'
import { metrics } from '../../lib/metrics'
import { Sentry } from '../../lib/sentry'
import { ChatService } from '../services/chat-service'
import { ChatRequestSchema } from '../types'
import { ConversationIdParamSchema } from '../utils/validation'

interface ChatRouteDeps {
  browser: Browser
  browserSession: BrowserSession
  browserosId?: string
  serverPort: number
  /** Shared with trust replay so promote patches the same live transcript. */
  sessionStore: SessionStore
  /** BrowserOS resources directory. Threaded to ACP providers so the
   *  bundled-Bun launcher under <resourcesDir>/bin/third_party/bun
   *  can be located for built-in adapters (claude / codex). */
  resourcesDir?: string | null
}

const ImportConversationsSchema = z.object({
  conversations: z.array(
    z.object({
      id: z.string().uuid(),
      lastMessagedAt: z.number().optional(),
      // UIMessage parts are heterogeneous; validate shape lightly and cast.
      messages: z.array(z.any()),
    }),
  ),
})

export function createChatRoutes(deps: ChatRouteDeps) {
  const sessionStore = deps.sessionStore
  const service = new ChatService({
    sessionStore,
    browser: deps.browser,
    browserSession: deps.browserSession,
    browserosId: deps.browserosId,
    serverPort: deps.serverPort,
    resourcesDir: deps.resourcesDir,
  })

  return new Hono()
    .post('/', zValidator('json', ChatRequestSchema), async (c) => {
      const request = c.req.valid('json')

      // Sentry + metrics (HTTP concerns only)
      Sentry.getCurrentScope().setTag(
        'request-type',
        request.isScheduledTask ? 'schedule' : 'chat',
      )
      Sentry.setContext('request', {
        provider: request.provider,
        model: request.model,
        baseUrl: request.baseUrl
          ? (() => {
              try {
                return new URL(request.baseUrl).origin
              } catch {
                return undefined
              }
            })()
          : undefined,
      })

      metrics.log('chat.request', {
        provider: request.provider,
        model: request.model,
      })

      logger.info('Chat request received', {
        conversationId: request.conversationId,
        provider: request.provider,
        model: request.model,
      })

      return service.processMessage(request, c.req.raw.signal)
    })
    .get('/history', async (c) => {
      try {
        const history = await service.getHistory()
        return c.json(history)
      } catch (err) {
        logger.error('Failed to get chat history', {
          error: err instanceof Error ? err.message : String(err),
        })
        return c.json({ error: 'Failed to fetch history' }, 500)
      }
    })
    .post('/import', async (c) => {
      try {
        const body = ImportConversationsSchema.parse(await c.req.json())
        const result = await service.importConversations(
          body.conversations.map((conversation) => ({
            id: conversation.id,
            lastMessagedAt: conversation.lastMessagedAt,
            messages: conversation.messages as UIMessage[],
          })),
        )
        return c.json(result)
      } catch (err) {
        if (err instanceof z.ZodError) {
          return c.json(
            { error: 'Invalid import payload', details: err.issues },
            400,
          )
        }
        logger.error('Failed to import conversations', {
          error: err instanceof Error ? err.message : String(err),
        })
        return c.json({ error: 'Failed to import conversations' }, 500)
      }
    })
    .get(
      '/:conversationId/active',
      zValidator('param', ConversationIdParamSchema),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        const active = await service.getActiveTurn(conversationId)
        return c.json({ active })
      },
    )
    .get(
      '/:conversationId/stream',
      zValidator('param', ConversationIdParamSchema),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        const url = new URL(c.req.url)
        const turnId = url.searchParams.get('turnId')?.trim() || undefined
        const lastEventId =
          c.req.header('Last-Event-ID') ??
          url.searchParams.get('lastSeq') ??
          undefined
        const lastSeq =
          lastEventId != null && lastEventId !== ''
            ? Number.parseInt(lastEventId, 10)
            : undefined
        const response = service.attachTurn({
          conversationId,
          turnId,
          lastSeq: Number.isFinite(lastSeq) ? lastSeq : undefined,
          signal: c.req.raw.signal,
        })
        if (!response) {
          return c.json({ error: 'No active turn for this conversation' }, 404)
        }
        return response
      },
    )
    .post(
      '/:conversationId/cancel',
      zValidator('param', ConversationIdParamSchema),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        let reason: string | undefined
        try {
          const body = await c.req.json()
          if (body && typeof body.reason === 'string') reason = body.reason
        } catch {
          // empty body is fine
        }
        const cancelled = service.cancelTurn(conversationId, reason)
        return c.json({ cancelled })
      },
    )
    .get(
      '/:conversationId',
      zValidator('param', ConversationIdParamSchema),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        try {
          const conversation = await service.getConversation(conversationId)
          if (!conversation) {
            return c.json({ error: 'Conversation not found' }, 404)
          }
          const active = await service.getActiveTurn(conversationId)
          // Cast away AI SDK UIMessage depth so Hono client inference stays finite.
          return c.json({
            id: conversation.id,
            messages: conversation.messages as unknown[],
            activeTurn: active,
          })
        } catch (err) {
          logger.error('Failed to get conversation', {
            conversationId,
            error: err instanceof Error ? err.message : String(err),
          })
          return c.json({ error: 'Failed to fetch conversation' }, 500)
        }
      },
    )
    .delete(
      '/:conversationId',
      zValidator('param', ConversationIdParamSchema),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        const result = await service.deleteSession(conversationId)

        if (result.deleted) {
          return c.json({
            success: true,
            message: `Session ${conversationId} deleted`,
            sessionCount: result.sessionCount,
          })
        }

        return c.json(
          { success: false, message: `Session ${conversationId} not found` },
          404,
        )
      },
    )
    .get(
      '/:conversationId/messages',
      zValidator('param', ConversationIdParamSchema),
      zValidator(
        'query',
        z.object({
          beforeId: z.string().optional(),
          limit: z.coerce.number().int().positive().max(100).optional(),
        }),
      ),
      async (c) => {
        const { conversationId } = c.req.valid('param')
        const query = c.req.valid('query')
        try {
          const page = await service.listConversationMessages(conversationId, {
            beforeId: query.beforeId,
            limit: query.limit,
          })
          if (!page) {
            return c.json({ error: 'Conversation not found' }, 404)
          }
          return c.json(page)
        } catch (error) {
          logger.error('Failed to list conversation messages', {
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          })
          return c.json({ error: 'Failed to list messages' }, 500)
        }
      },
    )
    .get(
      '/:conversationId/tool-outputs/:toolCallId',
      zValidator(
        'param',
        z.object({ conversationId: z.string(), toolCallId: z.string() }),
      ),
      async (c) => {
        const { toolCallId } = c.req.valid('param')
        const output = sessionStore.outputStore.get(toolCallId)
        if (!output) {
          return c.json({ error: 'Output not found' }, 404)
        }
        return new Response(output.data, {
          headers: {
            'Content-Type': output.mimeType,
            'Cache-Control': 'private, max-age=60',
          },
        })
      },
    )
    .get(
      '/:conversationId/tool-images/:toolCallId',
      zValidator(
        'param',
        z.object({ conversationId: z.string(), toolCallId: z.string() }),
      ),
      async (c) => {
        const { toolCallId } = c.req.valid('param')
        const image = sessionStore.imageStore.get(toolCallId)
        if (!image) {
          return c.json({ error: 'Image not found' }, 404)
        }
        return new Response(
          image.data.buffer.slice(
            image.data.byteOffset,
            image.data.byteOffset + image.data.byteLength,
          ) as ArrayBuffer,
          {
            headers: {
              'Content-Type': image.mimeType,
              'Cache-Control': 'public, max-age=3600, immutable',
            },
          },
        )
      },
    )
}
