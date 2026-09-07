import { useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  Check,
  ChevronRight,
  FolderOpen,
  Pin,
  RefreshCw,
  X,
} from 'lucide-react'
import { type ComponentProps, type FC, useEffect, useState } from 'react'
import { openSidePanelWithSearch } from '@/lib/messaging/sidepanel/openSidepanelWithSearch'
import { navigatePiDocument } from '@/lib/personal-internet/pi-document'
import { executePiAction } from '@/lib/pi-actions'
import { executeWidgetAction } from '@/lib/widget-actions'
import { PiRailAction } from '@/screens/personal-internet/PiChrome'
import type { PiHomeProjection } from '@/screens/personal-internet/types'
import { piPost } from '@/screens/personal-internet/usePiApi'
import { HOME_QUERY_KEY } from './home-data'
import { homeRefreshMessage } from './home-feedback'
import { templateIcon } from './template-visuals'

export function HomeAction(props: ComponentProps<typeof PiRailAction>) {
  return (
    <PiRailAction
      {...props}
      className="h-9 gap-2 rounded-lg border-border/60 px-3 font-sans text-xs normal-case tracking-normal"
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

  useEffect(() => {
    const expiries = (data?.continuity ?? []).flatMap((block) =>
      block.metadata?.kind === 'approval' &&
      typeof block.metadata.expiresAt === 'number' &&
      block.metadata.expiresAt > Date.now()
        ? [block.metadata.expiresAt]
        : [],
    )
    if (!expiries.length) return
    const timer = window.setTimeout(
      () => {
        void queryClient.invalidateQueries({ queryKey: HOME_QUERY_KEY })
      },
      Math.min(
        2_147_483_647,
        Math.max(50, Math.min(...expiries) - Date.now() + 50),
      ),
    )
    return () => window.clearTimeout(timer)
  }, [data?.continuity, queryClient])

  if (!data) return null
  const continuity = data.continuity.filter(
    (block) =>
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
          className={`rounded-xl px-4 py-3 text-sm ${note.error ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
        >
          {note.text}
        </p>
      ) : null}
      <section
        aria-labelledby="home-attention"
        className="rounded-2xl border border-border/70 bg-background p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="home-attention"
            className="flex items-center gap-2 font-semibold text-base"
          >
            <Bell className="size-4 text-muted-foreground" />
            Needs attention
            {continuity.length > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                {continuity.length}
              </span>
            ) : null}
          </h2>
          <HomeAction
            disabled={!!busy}
            onClick={() =>
              void run('refresh', async () => {
                const response = await post('/pi/home/refresh', {})
                return homeRefreshMessage(await response.json())
              })
            }
          >
            <RefreshCw
              className={`size-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`}
            />
            {busy === 'refresh' ? 'Checking…' : 'Check for updates'}
          </HomeAction>
        </div>
        {continuity.length === 0 ? (
          <div className="flex items-center gap-3 pt-5 text-muted-foreground text-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <Check className="size-4" />
            </span>
            <div>
              <p className="font-medium text-foreground">
                You’re all caught up
              </p>
              <p className="mt-1 text-xs">
                Requests and follow-ups from your saved work appear here.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 divide-y divide-border/60">
            {visible.map((block) => {
              const tokens = approvalTokens(block.metadata)
              const isApproval = block.metadata?.kind === 'approval'
              return (
                <article key={block.id} className="py-4 first:pt-0 last:pb-0">
                  <h3 className="font-medium text-sm">{block.title}</h3>
                  {isApproval ? (
                    <p className="mt-2 whitespace-pre-line text-muted-foreground text-sm leading-relaxed">
                      {block.body}
                    </p>
                  ) : (
                    <details className="mt-1 text-muted-foreground text-sm">
                      <summary className="cursor-pointer truncate">
                        {block.body.split('\n')[0]}
                      </summary>
                      <p className="mt-2 whitespace-pre-line leading-relaxed">
                        {block.body}
                      </p>
                    </details>
                  )}
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
                    ) : isApproval ? (
                      <HomeAction to="/settings/action-log">
                        Review request
                      </HomeAction>
                    ) : (
                      <>
                        {block.route ? (
                          <HomeAction to={routePath(block.route)}>
                            View details
                            <ChevronRight className="size-3" />
                          </HomeAction>
                        ) : null}
                        {block.agentQuery ? (
                          <HomeAction
                            disabled={!!busy}
                            onClick={() =>
                              void run(block.id, async () => {
                                const query = block.agentQuery
                                if (!query) return undefined
                                await executePiAction({
                                  kind: 'agent',
                                  query,
                                  metadata: block.metadata ?? {},
                                })
                                return undefined
                              })
                            }
                          >
                            Ask Pane to help
                          </HomeAction>
                        ) : null}
                      </>
                    )}
                    {!isApproval ? (
                      <HomeAction
                        disabled={!!busy}
                        onClick={() =>
                          mutate(block.id, '/pi/home/continuity/dismiss', {
                            id: block.id,
                          })
                        }
                      >
                        Dismiss
                      </HomeAction>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
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

      {data.libraryCount > 0 ? (
        <section aria-labelledby="home-saved-work">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2
              id="home-saved-work"
              className="flex items-center gap-2 font-semibold text-base"
            >
              <FolderOpen className="size-4 text-muted-foreground" />
              Your saved work
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
                    className="group rounded-2xl border border-border/70 bg-background p-4 transition-colors hover:border-primary/40"
                  >
                    <button
                      type="button"
                      className="w-full rounded-lg text-left focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={() =>
                        navigatePiDocument(routePath(doorway.primaryRoute))
                      }
                    >
                      <div className="mb-5 flex items-center justify-between">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon className="size-5" />
                        </span>
                        {doorway.updatedSinceLastVisit ? (
                          <span className="rounded-full bg-primary/10 px-2 py-1 text-primary text-xs">
                            Updated
                          </span>
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </div>
                      <h3 className="truncate font-medium text-base">
                        {doorway.name}
                      </h3>
                      <p className="mt-1 line-clamp-2 min-h-10 text-muted-foreground text-sm">
                        {doorway.pulseLine}
                      </p>
                    </button>
                    <div className="mt-3 flex gap-2 border-border/50 border-t pt-3">
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
                        className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs hover:bg-muted disabled:opacity-50"
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
                        className="ml-auto flex min-h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground text-xs hover:bg-muted disabled:opacity-50"
                      >
                        <X className="size-3" />
                        Hide
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="rounded-xl bg-muted/40 p-4 text-muted-foreground text-sm">
              Your work is saved in the library. Open “View all” to find it.
            </p>
          )}
        </section>
      ) : null}
      {data.proposeDoorways?.length ? (
        <details className="rounded-xl border border-border/60 p-4">
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
