import { useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronRight, MoreHorizontal, Pin, X } from 'lucide-react'
import { type ComponentProps, type FC, useEffect, useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { navigatePiDocument } from '@/lib/personal-internet/pi-document'
import { executeWidgetAction } from '@/lib/widget-actions'
import { piSiteField } from '@/screens/personal-internet/field'
import { PiRailAction } from '@/screens/personal-internet/PiChrome'
import type { PiHomeProjection } from '@/screens/personal-internet/types'
import { piPost } from '@/screens/personal-internet/usePiApi'
import { HOME_QUERY_KEY } from './home-data'
import { templateIcon } from './template-visuals'

export function HomeAction(props: ComponentProps<typeof PiRailAction>) {
  return (
    <PiRailAction
      {...props}
      className={`h-8 gap-2 px-2.5 font-mono text-[10px] uppercase tracking-[0.06em] ${props.className ?? ''}`}
    />
  )
}

function approvalTokens(metadata: Record<string, unknown> | undefined) {
  if (metadata?.kind !== 'approval') return null
  const { approvalId, approveToken, denyToken, conversationId } = metadata
  if (
    typeof approvalId !== 'string' ||
    !approvalId ||
    typeof approveToken !== 'string' ||
    !approveToken ||
    typeof denyToken !== 'string' ||
    !denyToken
  )
    return null
  return {
    approvalId,
    approveToken,
    denyToken,
    conversationId: typeof conversationId === 'string' ? conversationId : null,
  }
}

const routePath = (route: string) =>
  route.startsWith('#/') ? route.slice(1) : route

export const PiHomeRegions: FC<{ data?: PiHomeProjection | null }> = ({
  data,
}) => {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(
    null,
  )
  const [showAll, setShowAll] = useState(false)
  const [expiryTime, setExpiryTime] = useState(Date.now)

  useEffect(() => {
    const expiries = (data?.continuity ?? []).flatMap((block) =>
      block.metadata?.kind === 'approval' &&
      typeof block.metadata.expiresAt === 'number' &&
      block.metadata.expiresAt > Math.max(expiryTime, Date.now())
        ? [block.metadata.expiresAt]
        : [],
    )
    if (!expiries.length) return
    const timer = window.setTimeout(
      () => {
        setExpiryTime(Date.now())
        void queryClient.invalidateQueries({ queryKey: HOME_QUERY_KEY })
      },
      Math.min(
        2_147_483_647,
        Math.max(50, Math.min(...expiries) - Date.now() + 50),
      ),
    )
    return () => window.clearTimeout(timer)
  }, [data?.continuity, queryClient, expiryTime])

  if (!data) return null
  const continuity = data.continuity.filter(
    (block) =>
      block.metadata?.kind === 'approval' &&
      !(
        block.metadata?.kind === 'approval' &&
        typeof block.metadata.expiresAt === 'number' &&
        block.metadata.expiresAt <= Date.now()
      ),
  )
  const visible = showAll ? continuity : continuity.slice(0, 3)

  const run = async (id: string, action: () => Promise<string | undefined>) => {
    if (busy) return
    setBusy(id)
    setNote(null)
    try {
      const text = await action()
      await queryClient.invalidateQueries({ queryKey: HOME_QUERY_KEY })
      if (text) setNote({ error: false, text })
    } catch {
      setNote({ error: true, text: 'That didn’t complete. Please try again.' })
    } finally {
      setBusy(null)
    }
  }
  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await piPost(path, body)
    if (!response.ok) throw new Error('Request failed')
    return response
  }
  const mutate = (id: string, path: string, body: Record<string, unknown>) =>
    void run(id, async () => {
      await post(path, body)
      return undefined
    })

  return (
    <div className="space-y-8">
      {note ? (
        <p
          role={note.error ? 'alert' : 'status'}
          className={`border border-border px-3 py-2 font-mono text-xs ${note.error ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
        >
          {note.text}
        </p>
      ) : null}
      {continuity.length > 0 ? (
        <section
          aria-labelledby="home-attention"
          className="border-border border-y py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="home-attention"
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em]"
            >
              <Bell className="size-4 text-muted-foreground" />
              Pending decisions
              {continuity.length > 0 ? (
                <span className="border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {continuity.length}
                </span>
              ) : null}
            </h2>
          </div>
          <div className="mt-4 divide-y divide-border/60">
            {visible.map((block) => {
              const tokens = approvalTokens(block.metadata)
              return (
                <article key={block.id} className="py-4 first:pt-0 last:pb-0">
                  <h3 className="font-medium text-sm">{block.title}</h3>
                  <p className="mt-2 whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
                    {block.body}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {tokens ? (
                      <>
                        <HomeAction
                          variant="primary"
                          disabled={!!busy}
                          onClick={() =>
                            void run(block.id, async () => {
                              const result = await executeWidgetAction(
                                {
                                  type: 'resolve-approval',
                                  approvalId: tokens.approvalId,
                                  token: tokens.approveToken,
                                  resolution: 'approve',
                                },
                                queryClient,
                              )
                              if (result && !result.ok)
                                throw new Error(result.detail)
                              return result?.detail ?? 'Approved'
                            })
                          }
                        >
                          Approve
                        </HomeAction>
                        <HomeAction
                          disabled={!!busy}
                          onClick={() =>
                            void run(block.id, async () => {
                              const result = await executeWidgetAction(
                                {
                                  type: 'resolve-approval',
                                  approvalId: tokens.approvalId,
                                  token: tokens.denyToken,
                                  resolution: 'deny',
                                },
                                queryClient,
                              )
                              if (result && !result.ok)
                                throw new Error(result.detail)
                              return result?.detail ?? 'Declined'
                            })
                          }
                        >
                          Decline
                        </HomeAction>
                        {tokens.conversationId ? (
                          <HomeAction
                            disabled={!!busy}
                            onClick={() =>
                              void run(block.id, async () => {
                                const conversationId = tokens.conversationId
                                if (!conversationId) return undefined
                                await openSidePanelWithSearch('open', {
                                  requestId: crypto.randomUUID(),
                                  query: '',
                                  mode: 'agent',
                                  conversationId,
                                })
                                return undefined
                              })
                            }
                          >
                            View conversation
                          </HomeAction>
                        ) : (
                          <HomeAction to="/settings/action-log">
                            View details
                          </HomeAction>
                        )}
                      </>
                    ) : (
                      <HomeAction to="/settings/action-log">
                        Review request
                      </HomeAction>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
          {continuity.length > 3 ? (
            <button
              type="button"
              className="mt-4 text-primary text-sm hover:underline"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? 'Show less' : `Show all ${continuity.length} items`}
            </button>
          ) : null}
        </section>
      ) : null}

      {data.libraryCount > 0 ? (
        <section aria-labelledby="home-saved-work">
          <div className="mb-4 flex items-center justify-between gap-3 border-border border-t pt-5">
            <h2
              id="home-saved-work"
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em]"
            >
              Sites
            </h2>
            <HomeAction to="/pi/library">
              View all
              <ChevronRight className="size-3" />
            </HomeAction>
          </div>
          {data.doorways.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.doorways.map((doorway) => {
                const Icon = templateIcon(doorway.templateId)
                return (
                  <div
                    key={doorway.siteId}
                    data-field={piSiteField(doorway.siteId)}
                    className="home-color-tile group min-w-0 border p-4 transition-colors"
                  >
                    <div className="home-site-header">
                      <span className="home-site-symbol" aria-hidden="true">
                        <Icon className="size-5" />
                      </span>
                      <span className="home-site-update">
                        {doorway.updatedSinceLastVisit ? (
                          <span
                            className="size-1.5 bg-current"
                            title="Updated since your last visit"
                            role="img"
                            aria-label="Updated"
                          />
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className="home-icon-button home-site-open"
                        aria-label={`Open ${doorway.name}`}
                        title="Open site"
                        onClick={() =>
                          navigatePiDocument(routePath(doorway.primaryRoute))
                        }
                      >
                        <ChevronRight className="size-4" />
                      </button>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="home-icon-button home-site-menu"
                            aria-label={`Options for ${doorway.name}`}
                            title="More options"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          className="home-floating w-44 p-2"
                        >
                          <button
                            type="button"
                            aria-pressed={doorway.pinned}
                            disabled={!!busy}
                            onClick={() =>
                              mutate(
                                doorway.siteId,
                                '/pi/home/doorway/visibility',
                                doorway.pinned
                                  ? { unpinSiteId: doorway.siteId }
                                  : { pinSiteId: doorway.siteId },
                              )
                            }
                            className="home-menu-action disabled:opacity-50"
                          >
                            <Pin className="size-3" />
                            {doorway.pinned ? 'Pinned' : 'Pin'}
                          </button>
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() =>
                              mutate(
                                doorway.siteId,
                                '/pi/home/doorway/visibility',
                                { hideSiteId: doorway.siteId },
                              )
                            }
                            className="home-menu-action disabled:opacity-50"
                          >
                            <X className="size-3" />
                            Hide
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <button
                      type="button"
                      className="mt-4 w-full min-w-0 text-left focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={() =>
                        navigatePiDocument(routePath(doorway.primaryRoute))
                      }
                    >
                      <h3
                        className="line-clamp-2 font-medium text-base leading-5 [overflow-wrap:anywhere]"
                        title={doorway.name}
                      >
                        {doorway.name}
                      </h3>
                      <p
                        className="mt-2 line-clamp-2 text-muted-foreground text-xs leading-4 [overflow-wrap:anywhere]"
                        title={doorway.pulseLine}
                      >
                        {doorway.pulseLine}
                      </p>
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="border border-border bg-muted/40 p-4 text-muted-foreground text-sm">
              Your work is saved in the library. Open “View all” to find it.
            </p>
          )}
        </section>
      ) : null}
      {data.proposeDoorways?.length ? (
        <details className="border-border border-t py-4">
          <summary className="cursor-pointer text-muted-foreground text-sm">
            Add saved work to Home
          </summary>
          <div className="mt-3 space-y-3">
            {data.proposeDoorways.map((item) => (
              <div
                key={item.siteId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span className="text-sm">{item.name}</span>
                <div className="flex gap-2">
                  <HomeAction
                    disabled={!!busy}
                    onClick={() =>
                      mutate(item.siteId, `/pi/sites/${item.siteId}/doorway`, {
                        eligible: true,
                        pin: true,
                      })
                    }
                  >
                    Add to Home
                  </HomeAction>
                  <HomeAction to={routePath(item.route)}>Open</HomeAction>
                  <HomeAction
                    disabled={!!busy}
                    onClick={() =>
                      mutate(item.siteId, '/pi/home/propose/dismiss', {
                        siteId: item.siteId,
                      })
                    }
                  >
                    Not now
                  </HomeAction>
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}
