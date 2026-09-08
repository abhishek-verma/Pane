import {
  type AgendaDay,
  type AgendaItem,
  dayInTimezone,
  shiftDay,
} from '@browseros/shared/schemas/agenda'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckSquare2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FolderOpen,
  MoreHorizontal,
  Plus,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { agentFetch } from '@/lib/browseros/agent-fetch'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { sendScheduleMessage } from '@/lib/messaging/schedules/scheduleMessages'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import {
  normalizePiHref,
  openPiHref,
} from '@/lib/personal-internet/open-pi-href'
import { executePiAction } from '@/lib/pi-actions'
import { HomeInfo } from './HomeInfo'
import { HomeAction } from './PiHomeRegions'

const AGENDA_KEY = ['agenda'] as const
async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const base = await getAgentServerUrl()
  const response = await agentFetch(`${base}/scheduler/agenda${path}`, {
    method,
    ...(body
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  })
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? 'This item changed while you were editing it. Please try again.'
        : 'That didn’t complete. Please try again.',
    )
  return response.json() as Promise<T>
}
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
const clockLabel = (time: string, timezone: string) =>
  new Date(time).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  })
const kinds = {
  task: 'To do',
  event: 'Event',
  update: 'Update',
  prepared: 'Prepared for you',
}
const openConversation = (conversationId: string) =>
  openSidePanelWithSearch('open', {
    requestId: crypto.randomUUID(),
    query: '',
    mode: 'agent',
    conversationId,
  })
type Run = (id: string, action: () => Promise<void>) => Promise<void>
type Update = (
  item: AgendaItem,
  patch: { status?: AgendaItem['status']; day?: string },
) => void

function SourceAction({
  source,
  busy,
  open,
}: {
  source: AgendaItem['sources'][number]
  busy: boolean
  open: (action: () => Promise<void>) => void
}) {
  if (source.kind === 'conversation')
    return (
      <HomeAction
        className="home-text-action mr-2"
        disabled={busy}
        onClick={() =>
          open(async () => {
            await openConversation(source.reference)
          })
        }
      >
        Open <ArrowUpRight className="size-3.5" />
      </HomeAction>
    )
  if (source.kind === 'site' && normalizePiHref(source.reference))
    return (
      <HomeAction
        className="home-text-action mr-2"
        disabled={busy}
        onClick={() =>
          open(async () => {
            await openPiHref(source.reference)
          })
        }
      >
        Open <ArrowUpRight className="size-3.5" />
      </HomeAction>
    )
  if (/^https?:\/\//.test(source.reference))
    return (
      <a
        className="home-text-action mr-2"
        href={source.reference}
        target="_blank"
        rel="noreferrer"
      >
        Open <ArrowUpRight className="size-3.5" />
      </a>
    )
  return null
}

function AgendaRow({
  item,
  day,
  timezone,
  busy,
  run,
  update,
}: {
  item: AgendaItem
  day: string
  timezone: string
  busy: boolean
  run: Run
  update: Update
}) {
  const [moving, setMoving] = useState(false)
  const [moveDay, setMoveDay] = useState(() => shiftDay(day, 1))
  const Icon = {
    task: CheckSquare2,
    event: CalendarDays,
    update: Bell,
    prepared: FolderOpen,
  }[item.kind]
  return (
    <article className="home-agenda-row">
      <span
        data-field={
          { task: 'dust', event: 'iris', update: 'ember', prepared: 'moss' }[
            item.kind
          ]
        }
        className="home-color-tile flex size-10 shrink-0 items-center justify-center"
        title={kinds[item.kind]}
      >
        <Icon className="size-[18px] text-foreground/70" />
      </span>
      <div className="home-agenda-title min-w-0">
        <h3
          className="line-clamp-2 font-medium text-sm leading-5 [overflow-wrap:anywhere]"
          title={item.title}
        >
          {item.title}
        </h3>
        {item.startsAt || item.day < day || item.certainty === 'suggested' ? (
          <p className="mt-1 text-muted-foreground text-xs">
            {item.startsAt
              ? clockLabel(item.startsAt, timezone)
              : item.day < day
                ? `From ${dayLabel(item.day)}`
                : 'Suggested'}
            {item.startsAt && item.endsAt
              ? ` – ${clockLabel(item.endsAt, timezone)}`
              : ''}
            {item.startsAt && item.certainty === 'suggested'
              ? ' · Suggested'
              : ''}
          </p>
        ) : null}
      </div>
      <div className="home-agenda-actions flex items-center gap-1">
        {item.agentQuery ? (
          <button
            type="button"
            className="home-text-action mr-2"
            disabled={busy}
            onClick={() =>
              void run(item.id, async () => {
                if (item.agentQuery)
                  await executePiAction({
                    kind: 'agent',
                    query: item.agentQuery,
                    metadata: {
                      agendaItemId: item.id,
                      agendaDay: item.day,
                      sources: item.sources,
                    },
                  })
              })
            }
          >
            Ask Pane <ArrowUpRight className="size-3.5" />
          </button>
        ) : (item.kind === 'prepared' || item.kind === 'event') &&
          item.sources[0] ? (
          <SourceAction
            source={item.sources[0]}
            busy={busy}
            open={(action) => void run(item.id, action)}
          />
        ) : null}
        <button
          type="button"
          className="home-icon-button"
          disabled={busy}
          title={
            ['update', 'prepared'].includes(item.kind)
              ? 'Mark as seen'
              : 'Mark as done'
          }
          aria-label={`Mark ${item.title} as ${['update', 'prepared'].includes(item.kind) ? 'seen' : 'done'}`}
          onClick={() => update(item, { status: 'done' })}
        >
          <Check className="size-4" />
        </button>
        <HomeInfo label={`About ${item.title}`}>
          <h3 className="font-medium text-sm">{item.title}</h3>
          <p className="text-muted-foreground">{item.why}</p>
          {item.detail ? (
            <p className="whitespace-pre-line text-muted-foreground">
              {item.detail}
            </p>
          ) : null}
          {item.certainty === 'suggested' ? (
            <p>Suggested by Pane; not a confirmed commitment.</p>
          ) : null}
          {item.sources.map((source) => (
            <div
              key={`${source.reference}-${source.observedAt}`}
              className="space-y-1 border-border border-t pt-3"
            >
              <p className="font-medium">{source.label}</p>
              <p className="text-muted-foreground">{source.evidence}</p>
              <SourceAction
                source={source}
                busy={busy}
                open={(action) => void run(item.id, action)}
              />
            </div>
          ))}
        </HomeInfo>
        <Popover
          onOpenChange={(open) => {
            if (!open) setMoving(false)
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="home-icon-button"
              aria-label={`More options for ${item.title}`}
              title="More options"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="home-floating w-64 p-2">
            <button
              type="button"
              disabled={busy}
              className="home-menu-action"
              onClick={() => setMoving(!moving)}
            >
              <CalendarDays className="size-4" />
              Move to another day
            </button>
            <button
              type="button"
              disabled={busy}
              className="home-menu-action"
              onClick={() => update(item, { status: 'dismissed' })}
            >
              <EyeOff className="size-4" />
              Hide
            </button>
            {moving ? (
              <form
                className="mt-2 space-y-2 border-border border-t p-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  update(item, { day: moveDay })
                  setMoving(false)
                }}
              >
                <input
                  aria-label={`Move ${item.title} to date`}
                  type="date"
                  required
                  value={moveDay}
                  onChange={(event) => setMoveDay(event.target.value)}
                  className="home-date-input w-full"
                />
                <HomeAction
                  disabled={busy || !moveDay}
                  onClick={() => {
                    update(item, { day: moveDay })
                    setMoving(false)
                  }}
                >
                  Move item
                </HomeAction>
                {item.kind === 'event' ? (
                  <p className="text-muted-foreground text-xs">
                    Moves the Pane entry, not the original event.
                  </p>
                ) : null}
              </form>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
    </article>
  )
}

function ReviewStatus({
  review,
  timezone,
  run,
}: {
  review: AgendaDay['review']
  timezone: string
  run: Run
}) {
  if (!review) return null
  const messages = {
    queued: 'Queued',
    running: 'Checking for updates…',
    waiting: 'Needs your input',
    failed: 'Couldn’t finish the check',
    partial: 'Partly checked',
    complete: 'Up to date',
  }
  const openReview = () =>
    void run('review', async () => {
      if (review.conversationId) await openConversation(review.conversationId)
    })
  return (
    <div
      role="status"
      className="flex items-center gap-1 text-muted-foreground text-xs"
    >
      <span>{messages[review.state]}</span>
      <HomeInfo label="About this update">
        {review.message ? <p>{review.message}</p> : null}
        {review.report ? (
          <>
            <p>{review.report.summary}</p>
            <p>
              Checked:{' '}
              {review.report.checked.join(', ') || 'No sources verified'}
            </p>
            {review.report.unavailable.length ? (
              <p>Couldn’t check: {review.report.unavailable.join(', ')}</p>
            ) : null}
          </>
        ) : null}
        {review.checkedAt ? (
          <p className="text-muted-foreground">
            {new Date(review.checkedAt).toLocaleString(undefined, {
              timeZone: timezone,
            })}
          </p>
        ) : null}
        {review.conversationId ? (
          <button
            type="button"
            className="home-text-action"
            onClick={openReview}
          >
            Open review <ArrowUpRight className="size-3.5" />
          </button>
        ) : null}
      </HomeInfo>
      {review.state === 'waiting' && review.conversationId ? (
        <button type="button" className="home-text-action" onClick={openReview}>
          Review request
        </button>
      ) : null}
    </div>
  )
}

function EmptyDay({ hasClosed }: { hasClosed: boolean }) {
  return (
    <div className="flex items-start gap-3 py-5">
      <CalendarDays className="mt-0.5 size-5 text-muted-foreground" />
      <div>
        <p className="font-medium text-sm">
          {hasClosed ? 'All caught up' : 'Nothing planned yet'}
        </p>
        <p className="mt-1 text-muted-foreground text-xs">
          Add a plan or check for updates.
        </p>
      </div>
    </div>
  )
}

function ClosedItems({
  items,
  busy,
  update,
}: {
  items: AgendaItem[]
  busy: boolean
  update: Update
}) {
  if (!items.length) return null
  return (
    <details className="mt-4 border-border border-t pt-3">
      <summary className="cursor-pointer text-muted-foreground text-xs">
        {items.length} completed or hidden
      </summary>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-muted-foreground">{item.title}</span>
            <HomeAction
              disabled={busy}
              onClick={() => update(item, { status: 'open' })}
            >
              Undo
            </HomeAction>
          </div>
        ))}
      </div>
    </details>
  )
}

export function TodayAgenda() {
  const queryClient = useQueryClient()
  const [timezone, setTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  )
  const [today, setToday] = useState(() => dayInTimezone(timezone))
  const [chosenDay, setChosenDay] = useState<string | null>(null)
  const day = chosenDay ?? today
  const [showAll, setShowAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    const id = window.setInterval(() => {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
      setTimezone(zone)
      setToday(dayInTimezone(zone))
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [...AGENDA_KEY, day, timezone],
    queryFn: () =>
      request<AgendaDay>(
        `?day=${day}&timezone=${encodeURIComponent(timezone)}`,
      ),
    refetchInterval: 3_000,
    staleTime: 2_000,
  })
  const changeDay = (value: string) => {
    setChosenDay(value === today ? null : value)
    setShowAll(false)
    setNote(null)
  }
  const run: Run = async (id, action) => {
    if (busy) return
    setBusy(id)
    setNote(null)
    try {
      await action()
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      await queryClient.invalidateQueries({ queryKey: AGENDA_KEY })
      setBusy(null)
    }
  }
  const update: Update = (item, patch) =>
    void run(item.id, async () => {
      await request(`/items/${encodeURIComponent(item.id)}`, 'PATCH', {
        expectedVersion: item.version,
        ...patch,
      })
    })
  const reviewing =
    !!data?.review &&
    ['queued', 'running', 'waiting'].includes(data.review.state)
  const open = data?.items.filter((item) => item.status === 'open') ?? []
  const closed = data?.items.filter((item) => item.status !== 'open') ?? []
  const visible = showAll ? open : open.slice(0, 3)
  const refresh = () =>
    void run('refresh', async () => {
      const response = await request<{
        review: NonNullable<AgendaDay['review']>
      }>('/refresh', 'POST', { day, timezone })
      // Background owns execution, so leaving Home doesn't cancel the review.
      await sendScheduleMessage('reviewAgenda', {
        runId: response.review.runId,
      }).catch(() => {
        setNote(
          'The review is saved in the queue. Pane will start it when its background agent is available.',
        )
      })
    })
  return (
    <section aria-labelledby="today-heading" className="home-today">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h2 id="today-heading" className="home-section-title">
            {day === today ? 'Today' : 'Agenda'}
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="home-date-trigger"
                aria-label="Choose agenda date"
              >
                {dayLabel(day)}
                <ChevronDown className="size-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="home-floating home-date-picker w-auto p-1"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="home-icon-button"
                  aria-label="Previous day"
                  onClick={() => changeDay(shiftDay(day, -1))}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <input
                  aria-label="Agenda date"
                  type="date"
                  value={day}
                  onChange={(event) => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value))
                      changeDay(event.target.value)
                  }}
                  className="home-date-input"
                />
                <button
                  type="button"
                  className="home-icon-button"
                  aria-label="Next day"
                  onClick={() => changeDay(shiftDay(day, 1))}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
              {chosenDay ? (
                <button
                  type="button"
                  className="home-menu-action justify-center"
                  onClick={() => changeDay(today)}
                >
                  Back to today
                </button>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="home-icon-button"
            disabled={!!busy}
            aria-label="Add item"
            title="Add item"
            onClick={() => setAdding(!adding)}
          >
            <Plus className="size-4" />
          </button>
          <button
            type="button"
            className="home-icon-button"
            disabled={!!busy || reviewing}
            aria-label={reviewing ? 'Checking your day' : 'Refresh today'}
            title={reviewing ? 'Checking your day' : 'Refresh today'}
            onClick={refresh}
          >
            <RefreshCw
              className={`size-3.5 ${reviewing ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>
      {adding ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void run('add', async () => {
              await request('/items', 'POST', {
                title: newTitle.trim(),
                day,
                timezone,
              })
              setNewTitle('')
              setAdding(false)
            })
          }}
        >
          <input
            aria-label="New agenda item"
            maxLength={160}
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            placeholder="What do you need to do?"
            className="min-w-0 flex-1 border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!!busy || !newTitle.trim()}
            className="border border-border px-3 font-mono text-[10px] uppercase disabled:opacity-50"
          >
            Save
          </button>
        </form>
      ) : null}
      {note ? (
        <p role="alert" className="mt-3 text-destructive text-sm">
          {note}
        </p>
      ) : null}
      {error && data ? (
        <p role="alert" className="mt-3 text-muted-foreground text-xs">
          Couldn’t load changes. Showing your last saved view.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </p>
      ) : null}
      <ReviewStatus
        review={data?.review ?? null}
        timezone={timezone}
        run={run}
      />
      {error && !data ? (
        <div
          role="alert"
          className="mt-4 flex items-center justify-between gap-3 text-sm"
        >
          <p>Today couldn’t load. Your saved items haven’t been removed.</p>
          <HomeAction onClick={() => void refetch()}>Retry</HomeAction>
        </div>
      ) : isLoading ? (
        <p role="status" className="py-6 text-muted-foreground text-sm">
          Loading your day…
        </p>
      ) : !open.length ? (
        <EmptyDay hasClosed={closed.length > 0} />
      ) : (
        <div className="divide-y divide-border">
          {visible.map((item) => (
            <AgendaRow
              key={`${day}-${item.id}`}
              item={item}
              day={day}
              timezone={timezone}
              busy={!!busy}
              run={run}
              update={update}
            />
          ))}
        </div>
      )}
      {open.length > 3 ? (
        <button
          type="button"
          className="mt-2 text-sm hover:underline"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show less' : `See all ${open.length} items`}
        </button>
      ) : null}
      <ClosedItems items={closed} busy={!!busy} update={update} />
    </section>
  )
}
