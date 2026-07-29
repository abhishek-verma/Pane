/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { BookOpen, ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { executePiAction } from '@/lib/pi-actions'
import type { PiHomeProjection } from '@/screens/personal-internet/types'

export const PiHomeRegions: FC<{ data?: PiHomeProjection | null }> = ({
  data,
}) => {
  if (!data) return null
  const { doorways, continuity, libraryCount } = data
  if (doorways.length === 0 && continuity.length === 0 && libraryCount === 0) {
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
            {continuity.map((block) => (
              <div
                key={block.id}
                className="rounded-lg border border-border/60 bg-card/30 px-3 py-2"
              >
                <div className="font-medium text-sm">{block.title}</div>
                <div className="text-muted-foreground text-xs">
                  {block.body}
                </div>
                <div className="mt-2 flex gap-2">
                  {block.route ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link
                        to={
                          block.route.startsWith('#/')
                            ? block.route.slice(1)
                            : block.route
                        }
                      >
                        Open
                      </Link>
                    </Button>
                  ) : null}
                  {block.agentQuery ? (
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
            ))}
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
              <Link
                key={d.siteId}
                to={
                  d.primaryRoute.startsWith('#/')
                    ? d.primaryRoute.slice(1)
                    : d.primaryRoute
                }
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/30 px-3 py-3 transition hover:border-border hover:bg-card/50"
              >
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm">{d.name}</div>
                  <div className="truncate text-muted-foreground text-xs">
                    {d.pulseLine}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
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
    </div>
  )
}
