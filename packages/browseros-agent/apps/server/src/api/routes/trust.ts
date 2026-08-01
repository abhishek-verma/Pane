import type { Browser } from '@browseros/browser-core/browser'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { BrowserContextSchema } from '@browseros/shared/schemas/browser-context'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import type { SessionStore } from '../../agent/session-store'
import { logger } from '../../lib/logger'
import { patchConversationToolOutput } from '../services/patch-conversation-tool-output'
import { replayToolCall } from '../services/trust-replay'
import type { Env } from '../types'

const ReplayToolRequestSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  conversationId: z.string().uuid().optional(),
  toolCallId: z.string().min(1).optional(),
  userWorkingDir: z.string().min(1).optional(),
  workspaceId: z.string().optional(),
  bucketId: z.string().optional(),
  trustPins: z
    .record(
      z.object({
        pinned: z.boolean(),
        expiresAt: z.number().optional(),
      }),
    )
    .optional(),
  browserContext: BrowserContextSchema.optional(),
  requireBrowserInputApproval: z.boolean().optional(),
})

interface TrustRouteDeps {
  browser: Browser
  browserSession: BrowserSession
  browserosId?: string
  sessionStore: SessionStore
}

export function createTrustRoutes(deps: TrustRouteDeps) {
  return new Hono<Env>().post(
    '/replay',
    zValidator('json', ReplayToolRequestSchema),
    async (c) => {
      const body = c.req.valid('json')
      try {
        const result = await replayToolCall(deps, body, c.req.raw.signal)

        if (body.conversationId && body.toolCallId) {
          try {
            const patched = await patchConversationToolOutput(
              deps.sessionStore,
              body.conversationId,
              body.toolCallId,
              body.toolName,
              result.output,
              result.isError,
            )
            if (!patched) {
              logger.warn('Trust replay did not find tool part to patch', {
                conversationId: body.conversationId,
                toolCallId: body.toolCallId,
                toolName: body.toolName,
              })
            }
          } catch (error) {
            logger.error('Failed to persist trust replay tool output', {
              conversationId: body.conversationId,
              toolCallId: body.toolCallId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }

        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Replay failed'
        return c.json({ error: message }, 400)
      }
    },
  )
}
