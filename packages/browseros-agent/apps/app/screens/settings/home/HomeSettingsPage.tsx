/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Home widget management settings page — #/settings/home
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

interface WidgetEntry {
  id: string
  title: string
  status: string
  showCount: number
  lastActionAt: string | null
  createdAt: string
  createdBy: string
  source: { type: string }
  whyText: string
}

const WIDGETS_KEY = ['scheduler', 'home', 'widgets'] as const

async function fetchWidgets(): Promise<WidgetEntry[]> {
  const base = await getAgentServerUrl()
  const res = await fetch(`${base}/scheduler/home/widgets`)
  if (!res.ok) return []
  const data = (await res.json()) as { widgets: WidgetEntry[] }
  return data.widgets
}

const STATUS_ORDER = ['active', 'staged', 'demoted', 'archived'] as const
type WidgetStatus = (typeof STATUS_ORDER)[number]

const STATUS_LABELS: Record<WidgetStatus, string> = {
  active: 'Active',
  staged: 'Suggested',
  demoted: 'Demoted (idle)',
  archived: 'Archived',
}

export const HomeSettingsPage: FC = () => {
  const qc = useQueryClient()
  const { data: widgets, isLoading } = useQuery({
    queryKey: WIDGETS_KEY,
    queryFn: fetchWidgets,
  })

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const base = await getAgentServerUrl()
      await fetch(`${base}/scheduler/home/widgets/${id}`, { method: 'DELETE' })
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: WIDGETS_KEY }),
  })

  const resetMutation = useMutation({
    mutationFn: async () => {
      const base = await getAgentServerUrl()
      await fetch(`${base}/scheduler/home/reset`, { method: 'POST' })
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: WIDGETS_KEY }),
  })

  const statusGroups: Partial<Record<WidgetStatus, WidgetEntry[]>> = {}
  for (const w of widgets ?? []) {
    const s = w.status as WidgetStatus
    const group = statusGroups[s]
    if (group) {
      group.push(w)
    } else {
      statusGroups[s] = [w]
    }
  }

  return (
    <div className="space-y-6 p-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg">Home widgets</h2>
          <p className="text-muted-foreground text-sm">
            Manage what appears on your new tab home.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Reset home
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

      {widgets?.length === 0 && !isLoading && (
        <p className="text-muted-foreground text-sm">
          No widgets yet. Add some from the home tab.
        </p>
      )}

      {STATUS_ORDER.map((status) => {
        const group = statusGroups[status]
        if (!group?.length) return null
        return (
          <div key={status} className="space-y-2">
            <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {STATUS_LABELS[status]}
            </h3>
            <div className="space-y-2">
              {group.map((w) => (
                <div
                  key={w.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border/50 bg-card p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{w.title}</p>
                    <div className="mt-0.5 flex flex-wrap gap-3 text-muted-foreground text-xs">
                      <span>{w.source.type}</span>
                      <span>shown {w.showCount}×</span>
                      {w.lastActionAt && (
                        <span>
                          last used{' '}
                          {new Date(w.lastActionAt).toLocaleDateString(
                            undefined,
                            {
                              month: 'short',
                              day: 'numeric',
                            },
                          )}
                        </span>
                      )}
                      <span className="italic">{w.createdBy}</span>
                    </div>
                    {w.whyText && (
                      <p className="mt-1 text-muted-foreground text-xs">
                        {w.whyText}
                      </p>
                    )}
                  </div>
                  {status !== 'archived' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground"
                      onClick={() => archiveMutation.mutate(w.id)}
                      disabled={archiveMutation.isPending}
                    >
                      {status === 'active' ? (
                        <Archive className="h-3.5 w-3.5" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
