import { type ToolSet, tool } from 'ai'
import { z } from 'zod'
import { getActiveGateContext } from '../agent/trust/gate'
import { finishAgendaReview } from './review'
import {
  AgendaReportSchema,
  AgendaUpdateSchema,
  AgendaUpsertSchema,
  DaySchema,
  dayInTimezone,
} from './schema'
import { listAgendaItems, updateAgendaItem, upsertAgendaItem } from './store'

async function result(action: () => unknown) {
  try {
    return { text: JSON.stringify(action()) }
  } catch (error) {
    return {
      text: error instanceof Error ? error.message : String(error),
      isError: true,
    }
  }
}
export function buildAgendaToolSet(): ToolSet {
  return {
    agenda_list: tool({
      description:
        'Read Pane’s persistent dated agenda. Use before adding or changing any commitment to prevent duplicates. Includes source references, user-protected fields and versions. With no dates, reads today in the local timezone. This is a local agenda, not an external calendar.',
      inputSchema: z.object({
        from: DaySchema.optional(),
        to: DaySchema.optional(),
        includeClosed: z.boolean().default(true),
      }),
      execute: async ({ from, to, includeClosed }) =>
        result(() => {
          const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
          const day = from ?? dayInTimezone(timezone)
          return {
            timezone,
            items: listAgendaItems(day, to ?? day, includeClosed),
          }
        }),
    }),
    agenda_upsert: tool({
      description:
        'Maintain an item on Pane’s local calendar from a real discussion, commitment, dated event, useful update or prepared result. Does not schedule an agent or write external apps. List first; reuse sourceKey from the underlying commitment/event (not the date), id and expectedVersion when updating. Supply evidence and real source references. User date/title/status choices are protected. Never invent deadlines, resurrect dismissed work, or fill an empty day with advice. Ambiguous proposals use certainty=suggested. startsAt/endsAt must include offsets and match day in timezone.',
      inputSchema: AgendaUpsertSchema,
      execute: async (input) =>
        result(() => ({ item: upsertAgendaItem(input) })),
    }),
    agenda_update: tool({
      description:
        'Change a local agenda item after reading its current version. Complete or dismiss only with source evidence; absence or silence is not completion. User-edited fields and closed items cannot be reopened by an agent. Moving a day clears exact times; use agenda_upsert to set a verified new time. This never performs the underlying task.',
      inputSchema: AgendaUpdateSchema.extend({
        evidence: z.string().trim().min(1).max(500),
      }),
      execute: async (input) =>
        result(() => ({
          item: updateAgendaItem(input, 'agent', input.evidence),
        })),
    }),
    agenda_review_finish: tool({
      description:
        'Save the outcome of the Today refresh assigned to this run. Required even if nothing changed. List actual sources checked and any unavailable sources; report partial when checks were incomplete. Do not claim complete solely because tool calls succeeded.',
      inputSchema: z.object({
        reviewId: z.string().min(1),
        report: AgendaReportSchema,
      }),
      execute: async ({ reviewId, report }) =>
        result(() => ({
          review: finishAgendaReview(
            reviewId,
            getActiveGateContext()?.scheduledRunId,
            report,
            getActiveGateContext()?.conversationId,
          ),
        })),
    }),
  }
}
