/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { executePiAction } from '@/lib/pi-actions'
import { executeWidgetAction } from '@/lib/widget-actions'
import { HOME_QUERY_KEY } from '@/screens/newtab/home/home-data'
import type { PiHomeProjection } from '@/screens/personal-internet/types'
import { piPost } from '@/screens/personal-internet/usePiApi'

function approvalTokens(metadata: Record<string, unknown> | undefined): {
  approvalId: string
  approveToken: string
  denyToken: string
} | null {
  if (metadata?.kind !== 'approval') return null
  const approvalId =
    typeof metadata.approvalId === 'string' ? metadata.approvalId : ''
  const approveToken =
    typeof metadata.approveToken === 'string' ? metadata.approveToken : ''
  const denyToken =
    typeof metadata.denyToken === 'string' ? metadata.denyToken : ''
  if (!approvalId || !approveToken || !denyToken) return null
  return { approvalId, approveToken, denyToken }
}

export const PiHomeRegions: FC<{ data?: PiHomeProjection | null }> = ({
  data,
}) => {
  const queryClient = useQueryClient()
  if (!data) return null
  const { doorways, continuity, libraryCount, proposeDoorways } = data
  if (
    doorways.length === 0 &&
    continuity.length === 0 &&
    libraryCount === 0 &&
    !(proposeDoorways && proposeDoorways.length > 0)
  ) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 pb-2">
      {continuity.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            Today
          </h2>
          <div className="space-y-2">
            {continuity.map((block) => {
              const tokens = approvalTokens(block.metadata)
              return (
                <div
                  key={block.id}
                  className="rounded-lg border border-border/60 bg-card/30 px-3 py-2"
                >
                  <div className="font-medium text-sm">{block.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {block.body}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tokens ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            void executeWidgetAction(
                              {
                                type: 'resolve-approval',
                                approvalId: tokens.approvalId,
                                token: tokens.approveToken,
                                resolution: 'approve',
                              },
                              queryClient,
                            )
                          }}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void executeWidgetAction(
                              {
                                type: 'resolve-approval',
                                approvalId: tokens.approvalId,
                                token: tokens.denyToken,
                                resolution: 'deny',
                              },
                              queryClient,
                            )
                          }}
                        >
                          Deny
                        </Button>
                      </>
                    ) : null}
                    {block.route ? (
                      <Button asChild size="sm" variant="secondary">
                        <Link
                          to={
                            block.route.startsWith('#/')
                              ? block.route.slice(1)
                              : block.route
                          }
                        >
                          {tokens ? 'Details' : 'Open'}
                        </Link>
                      </Button>
                    ) : null}
                    {!tokens && block.agentQuery ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const query = block.agentQuery
                          if (!query) return
                          void executePiAction({
                            kind: 'agent',
                            query,
                            metadata: block.metadata ?? {},
                          })
                        }}
                      >
                        Handle
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {doorways.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
              Living work
            </h2>
            <Link
              to="/pi/library"
              className="text-muted-foreground text-xs hover:text-foreground"
            >
              My sites ({libraryCount})
            </Link>
          </div>
          <div className="space-y-2">
            {doorways.map((d) => (
              <div
                key={d.siteId}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/30 px-3 py-3"
              >
                <Link
                  to={
                    d.primaryRoute.startsWith('#/')
                      ? d.primaryRoute.slice(1)
                      : d.primaryRoute
                  }
                  className="flex min-w-0 flex-1 items-center gap-3 transition hover:opacity-90"
                >
                  <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{d.name}</div>
                    <div className="truncate text-muted-foreground text-xs">
                      {d.pulseLine}
                      {d.lastUpdatedAt
                        ? ` · ${new Date(d.lastUpdatedAt).toLocaleString()}`
                        : ''}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
                {d.secondary ? (
                  <div className="flex shrink-0 flex-col gap-1">
                    {d.secondary.deepLink ? (
                      <Button asChild size="sm" variant="secondary">
                        <Link
                          to={
                            d.secondary.deepLink.startsWith('#/')
                              ? d.secondary.deepLink.slice(1)
                              : d.secondary.deepLink
                          }
                        >
                          {d.secondary.label.slice(0, 24)}
                        </Link>
                      </Button>
                    ) : d.secondary.agentQuery ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const q = d.secondary?.agentQuery
                          if (!q) return
                          void executePiAction({
                            kind: 'agent',
                            query: q,
                            metadata: d.secondary?.metadata ?? {},
                          })
                        }}
                      >
                        {d.secondary.label.slice(0, 24)}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : libraryCount > 0 ? (
        <div className="text-center">
          <Button asChild size="sm" variant="ghost">
            <Link to="/pi/library">My sites ({libraryCount})</Link>
          </Button>
        </div>
      ) : null}

      {proposeDoorways && proposeDoorways.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            Suggest for home
          </h2>
          <div className="space-y-2">
            {proposeDoorways.map((p) => (
              <div
                key={p.siteId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 border-dashed px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">{p.name}</div>
                  <div className="text-muted-foreground text-xs">
                    Add to Living work on home
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void piPost(`/pi/sites/${p.siteId}/doorway`, {
                        eligible: true,
                        pin: true,
                      }).then((res) => {
                        if (res.ok) {
                          void queryClient.invalidateQueries({
                            queryKey: [...HOME_QUERY_KEY],
                          })
                        }
                      })
                    }}
                  >
                    Add to home
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      to={p.route.startsWith('#/') ? p.route.slice(1) : p.route}
                    >
                      Open
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
