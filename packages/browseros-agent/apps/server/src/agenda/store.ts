import type { z } from 'zod'
import { getDbHandle } from '../lib/db'
import type { AgendaContent, AgendaItem } from './schema'
import {
  AgendaContentSchema,
  AgendaUpdateSchema,
  AgendaUpsertSchema,
  DaySchema,
  dayInTimezone,
  shiftDay,
  TimezoneSchema,
} from './schema'

export class AgendaConflict extends Error {}
const db = () => getDbHandle().sqlite

type ItemRow = {
  id: string
  source_key: string
  day: string
  status: AgendaItem['status']
  data_json: string
  version: number
  user_fields_json: string
  created_at: number
  updated_at: number
}
function decode(row: ItemRow): AgendaItem {
  return {
    ...JSON.parse(row.data_json),
    id: row.id,
    sourceKey: row.source_key,
    day: row.day,
    status: row.status,
    version: row.version,
    userFields: JSON.parse(row.user_fields_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function recordChange(
  before: AgendaItem | null,
  after: AgendaItem,
  actor: string,
  evidence?: string,
) {
  db()
    .prepare(
      'INSERT INTO agenda_changes (item_id, actor, before_json, after_json, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      after.id,
      actor,
      before ? JSON.stringify(before) : null,
      JSON.stringify(after),
      evidence ?? null,
      Date.now(),
    )
}
function requireItem(id: string): AgendaItem {
  const item = getAgendaItem(id)
  if (!item) throw new Error('Agenda item was not saved')
  return item
}
function getAgendaItem(id: string): AgendaItem | null {
  const row = db()
    .prepare('SELECT * FROM agenda_items WHERE id = ?')
    .get(id) as ItemRow | null
  return row ? decode(row) : null
}
export function listAgendaItems(
  from: string,
  to: string,
  includeClosed = true,
): AgendaItem[] {
  DaySchema.parse(from)
  DaySchema.parse(to)
  if (from > to || Date.parse(to) - Date.parse(from) > 93 * 86400000)
    throw new Error('Choose a date range of at most 93 days')
  const rows = db()
    .prepare(
      `SELECT * FROM agenda_items WHERE day >= ? AND day <= ? ${includeClosed ? '' : "AND status = 'open'"} ORDER BY day, updated_at DESC`,
    )
    .all(from, to) as ItemRow[]
  return rows.map(decode)
}
function validateTimes(content: AgendaContent) {
  if (
    content.startsAt &&
    dayInTimezone(content.timezone, Date.parse(content.startsAt)) !==
      content.day
  )
    throw new Error('Start time must fall on the item date in its timezone')
  if (
    content.endsAt &&
    (!content.startsAt ||
      Date.parse(content.endsAt) <= Date.parse(content.startsAt))
  )
    throw new Error('End time must follow start time')
}
export function upsertAgendaItem(
  input: z.input<typeof AgendaUpsertSchema>,
  actor: 'agent' | 'user' = 'agent',
): AgendaItem {
  const parsed = AgendaUpsertSchema.parse(input)
  return db().transaction(() => {
    const row = db()
      .prepare('SELECT * FROM agenda_items WHERE source_key = ?')
      .get(parsed.sourceKey) as ItemRow | null
    const existing = row ? decode(row) : null
    if (parsed.id && existing?.id !== parsed.id)
      throw new AgendaConflict('Item identity changed; list the agenda again')
    // Retried creates dedupe without overwriting newer content.
    if (existing && parsed.expectedVersion === undefined) return existing
    if (existing && parsed.expectedVersion !== existing.version)
      throw new AgendaConflict(
        'Item changed; list the agenda again before updating',
      )
    if (!existing && parsed.expectedVersion !== undefined)
      throw new AgendaConflict('Item no longer exists')
    let content = AgendaContentSchema.parse(parsed)
    if (actor === 'agent' && existing) {
      const preserved = Object.fromEntries(
        existing.userFields.map((key) => [
          key,
          existing[key as keyof AgendaItem],
        ]),
      )
      content = AgendaContentSchema.parse({ ...content, ...preserved })
    }
    validateTimes(content)
    const now = Date.now()
    const id = existing?.id ?? `agenda_${crypto.randomUUID()}`
    const userFields =
      actor === 'user' ? Object.keys(content) : (existing?.userFields ?? [])
    db()
      .prepare(`INSERT INTO agenda_items (id, source_key, day, status, data_json, version, user_fields_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET day=excluded.day, data_json=excluded.data_json, version=excluded.version, user_fields_json=excluded.user_fields_json, updated_at=excluded.updated_at`)
      .run(
        id,
        parsed.sourceKey,
        content.day,
        existing?.status ?? 'open',
        JSON.stringify(content),
        (existing?.version ?? 0) + 1,
        JSON.stringify(userFields),
        existing?.createdAt ?? now,
        now,
      )
    const saved = requireItem(id)
    recordChange(existing, saved, actor)
    return saved
  })()
}
export function updateAgendaItem(
  input: z.input<typeof AgendaUpdateSchema>,
  actor: 'agent' | 'user' = 'user',
  evidence?: string,
): AgendaItem {
  const patch = AgendaUpdateSchema.parse(input)
  return db().transaction(() => {
    const item = getAgendaItem(patch.id)
    if (!item || item.version !== patch.expectedVersion)
      throw new AgendaConflict('This item changed. Reload it and try again.')
    const fields = Object.keys(patch).filter(
      (key) => key !== 'id' && key !== 'expectedVersion',
    )
    if (
      actor === 'agent' &&
      (fields.some((key) => item.userFields.includes(key)) ||
        (item.status !== 'open' && patch.status === 'open'))
    )
      throw new AgendaConflict(
        'Keep the user’s changes and closed items; do not reopen them automatically.',
      )
    const content = AgendaContentSchema.parse({ ...item, ...patch })
    // Moving a day clears precise times instead of inventing a new meeting time.
    if (patch.day && patch.day !== item.day) {
      content.startsAt = null
      content.endsAt = null
    }
    const userFields =
      actor === 'user'
        ? [
            ...new Set([
              ...item.userFields,
              ...fields,
              ...(patch.day ? ['startsAt', 'endsAt'] : []),
            ]),
          ]
        : item.userFields
    db()
      .prepare(
        'UPDATE agenda_items SET day=?, status=?, data_json=?, user_fields_json=?, version=version+1, updated_at=? WHERE id=? AND version=?',
      )
      .run(
        content.day,
        patch.status ?? item.status,
        JSON.stringify(content),
        JSON.stringify(userFields),
        Date.now(),
        item.id,
        item.version,
      )
    const saved = requireItem(item.id)
    recordChange(item, saved, actor, evidence)
    return saved
  })()
}
export function agendaForDay(day: string, timezone: string, now = Date.now()) {
  DaySchema.parse(day)
  TimezoneSchema.parse(timezone)
  const isToday = day === dayInTimezone(timezone, now)
  const items = listAgendaItems(isToday ? shiftDay(day, -7) : day, day).filter(
    (item) =>
      item.day === day || (item.status === 'open' && item.kind === 'task'),
  )
  const rank = (item: AgendaItem) =>
    isToday &&
    item.kind === 'event' &&
    item.endsAt &&
    Date.parse(item.endsAt) < now
      ? 6
      : item.certainty === 'suggested'
        ? 5
        : item.priority === 'high'
          ? 0
          : item.day < day
            ? 1
            : item.kind === 'event'
              ? 2
              : item.kind === 'task'
                ? 3
                : 4
  items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.startsAt ? Date.parse(a.startsAt) : Infinity) -
        (b.startsAt ? Date.parse(b.startsAt) : Infinity) ||
      b.updatedAt - a.updatedAt ||
      a.id.localeCompare(b.id),
  )
  return { day, timezone, items, generatedAt: now }
}
