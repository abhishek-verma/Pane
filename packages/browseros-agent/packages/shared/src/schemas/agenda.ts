import { z } from 'zod'

export const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const parsed = new Date(`${day}T12:00:00Z`)
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === day
    )
  }, 'Use a real calendar date (YYYY-MM-DD)')
export const TimezoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'Use an IANA timezone')
export const AgendaSourceSchema = z.object({
  kind: z.enum(['conversation', 'file', 'app', 'site', 'user']),
  label: z.string().trim().min(1).max(100),
  reference: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(1).max(500),
  observedAt: z.string().datetime({ offset: true }),
})
export const AgendaContentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().max(1200).default(''),
  kind: z.enum(['task', 'event', 'update', 'prepared']),
  day: DaySchema,
  timezone: TimezoneSchema,
  startsAt: z.string().datetime({ offset: true }).nullable().default(null),
  endsAt: z.string().datetime({ offset: true }).nullable().default(null),
  priority: z.enum(['normal', 'high']).default('normal'),
  certainty: z.enum(['confirmed', 'suggested']).default('confirmed'),
  why: z.string().trim().min(1).max(240),
  sources: z.array(AgendaSourceSchema).min(1).max(8),
  agentQuery: z.string().trim().max(1000).nullable().default(null),
})
export const AgendaUpsertSchema = AgendaContentSchema.extend({
  sourceKey: z.string().trim().min(1).max(300),
  id: z.string().min(1).optional(),
  expectedVersion: z.number().int().positive().optional(),
})
export const AgendaUpdateSchema = z.object({
  id: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  status: z.enum(['open', 'done', 'dismissed']).optional(),
  day: DaySchema.optional(),
  title: z.string().trim().min(1).max(160).optional(),
})
export const AgendaReportSchema = z
  .object({
    outcome: z.enum(['complete', 'partial']),
    summary: z.string().trim().min(1).max(400),
    checked: z.array(z.string().trim().min(1).max(120)).max(20),
    unavailable: z.array(z.string().trim().min(1).max(160)).max(20),
  })
  .refine(
    (value) =>
      value.outcome !== 'complete' ||
      (value.checked.length > 0 && value.unavailable.length === 0),
    'A complete review needs checked sources and no unavailable sources',
  )
export type AgendaContent = z.infer<typeof AgendaContentSchema>
export type AgendaItem = AgendaContent & {
  id: string
  sourceKey: string
  status: 'open' | 'done' | 'dismissed'
  version: number
  userFields: string[]
  createdAt: number
  updatedAt: number
}
export type AgendaReport = z.infer<typeof AgendaReportSchema>
export function dayInTimezone(timezone: string, at = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
export function shiftDay(day: string, offset: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export type AgendaReview = {
  id: string
  runId: string
  state: 'queued' | 'running' | 'waiting' | 'failed' | 'partial' | 'complete'
  conversationId: string | null
  startedAt: number
  checkedAt: number | null
  report: AgendaReport | null
  message: string | null
}
export type AgendaDay = {
  day: string
  timezone: string
  items: AgendaItem[]
  generatedAt: number
  review: AgendaReview | null
}
