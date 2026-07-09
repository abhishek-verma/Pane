import type { Browser } from '@browseros/browser-core/browser'
import type { BrowserSession } from '@browseros/browser-core/core/session'
import { BrowserContextSchema } from '@browseros/shared/schemas/browser-context'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { replayToolCall } from '../services/trust-replay'
import type { Env } from '../types'

const ReplayToolRequestSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  conversationId: z.string().uuid().optional(),
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
})

interface TrustRouteDeps {
  browser: Browser
  browserSession: BrowserSession
  browserosId?: string
}

export function createTrustRoutes(deps: TrustRouteDeps) {
  return new Hono<Env>().post(
    '/replay',
    zValidator('json', ReplayToolRequestSchema),
    async (c) => {
      const body = c.req.valid('json')
      try {
        const result = await replayToolCall(deps, body, c.req.raw.signal)
        return c.json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Replay failed'
        return c.json({ error: message }, 400)
      }
    },
  )
}
