import type { Browser } from '@browseros/browser-core/browser'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { SessionStore } from '../../agent/session-store'
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
  /** BrowserOS resources directory. Threaded to ACP providers so the
   *  bundled-Bun launcher under <resourcesDir>/bin/third_party/bun
   *  can be located for built-in adapters (claude / codex). */
  resourcesDir?: string | null
}

export function createChatRoutes(deps: ChatRouteDeps) {
  const sessionStore = new SessionStore()
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
}
