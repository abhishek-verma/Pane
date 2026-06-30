import { Hono } from 'hono'
import { listActionLogEntries } from '../../agent/trust/action-log'
import type { Env } from '../types'

export function createActionLogRoutes() {
  return new Hono<Env>().get('/', async (c) => {
    const conversationId = c.req.query('conversationId')
    const runId = c.req.query('runId')
    const consequenceClass = c.req.query('consequenceClass')

    const rows = await listActionLogEntries({
      conversationId: conversationId || undefined,
      runId: runId || undefined,
      consequenceClass: consequenceClass || undefined,
    })

    return c.json({ entries: rows })
  })
}
