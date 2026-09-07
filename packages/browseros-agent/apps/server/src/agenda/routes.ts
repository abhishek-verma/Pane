import { Hono } from 'hono'
import { z } from 'zod'
import { getAgendaReview, queueAgendaReview } from './review'
import { AgendaUpdateSchema, DaySchema, TimezoneSchema } from './schema'
import {
  AgendaConflict,
  agendaForDay,
  updateAgendaItem,
  upsertAgendaItem,
} from './store'

const DayRequest = z.object({ day: DaySchema, timezone: TimezoneSchema })
export function createAgendaRoutes() {
  return new Hono()
    .onError((error, c) =>
      c.json(
        {
          error:
            error instanceof AgendaConflict
              ? error.message
              : error instanceof z.ZodError
                ? 'Please check the date and item details.'
                : 'The agenda request did not complete.',
        },
        error instanceof AgendaConflict
          ? 409
          : error instanceof z.ZodError
            ? 400
            : 500,
      ),
    )
    .get('/', (c) => {
      const { day, timezone } = DayRequest.parse(c.req.query())
      return c.json({
        ...agendaForDay(day, timezone),
        review: getAgendaReview(day, timezone),
      })
    })
    .post('/items', async (c) => {
      const input = DayRequest.extend({
        title: z.string().trim().min(1).max(160),
      }).parse(await c.req.json())
      return c.json(
        {
          item: upsertAgendaItem(
            {
              ...input,
              sourceKey: `user:${crypto.randomUUID()}`,
              kind: 'task',
              why: 'Added by you',
              sources: [
                {
                  kind: 'user',
                  label: 'You',
                  reference: 'manual',
                  evidence: input.title,
                  observedAt: new Date().toISOString(),
                },
              ],
            },
            'user',
          ),
        },
        201,
      )
    })
    .patch('/items/:id', async (c) => {
      const input = AgendaUpdateSchema.parse({
        ...(await c.req.json()),
        id: c.req.param('id'),
      })
      return c.json({ item: updateAgendaItem(input, 'user') })
    })
    .post('/refresh', async (c) => {
      const { day, timezone } = DayRequest.parse(await c.req.json())
      return c.json({ review: queueAgendaReview(day, timezone) }, 202)
    })
}
