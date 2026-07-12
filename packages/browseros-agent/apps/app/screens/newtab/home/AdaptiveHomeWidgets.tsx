/**
 * Adaptive home widgets — loads cached digest + local queries only.
 * Never calls chat/LLM endpoints.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { type FC, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { getAgentServerUrl } from '@/lib/browseros/helpers'
import { EmptyHomeState } from './EmptyHomeState'
import { ProposalCard } from './ProposalCard'
import { WidgetCard } from './WidgetCard'

export interface HomeWidget {
  type: string
  title: string
  why: string
  rank: number
  pinned?: boolean
  hidden?: boolean
  data: Record<string, unknown>
  // Phase 8 extensions
  id?: string
  status?: 'active' | 'staged'
  source?: {
    type: string
    query?: string
    templateId?: string
    bucketId?: string
  }
  action?: { type: string; target: string }
  whyText?: string
  createdBy?: 'user' | 'agent' | 'system'
}

export interface HomeData {
  widgets: HomeWidget[]
  proposals?: HomeWidget[]
  firstName?: string | null
}

const HOME_KEY = ['scheduler', 'home'] as const

/** Module-level flag for tests: home loader must not hit /chat. */
export let homeLoaderCalledChat = false
export function resetHomeLoaderChatFlag() {
  homeLoaderCalledChat = false
}

async function fetchHome(): Promise<HomeData> {
  const base = await getAgentServerUrl()
  // Perf / ship-gate: only /scheduler/home — never /chat or generateText.
  const url = `${base}/scheduler/home`
  if (url.includes('/chat')) homeLoaderCalledChat = true
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Home load failed: ${res.status}`)
  return res.json() as Promise<HomeData>
}

function handleCuratedAction(w: HomeWidget): void {
  const routes: Record<string, string> = {
    'next-meeting': '#/capture',
    'research-thread': '#/capture',
    'pending-approvals': '#/tasks',
    'one-click-recurring': '#/scheduled',
    'daily-digest': '#/home',
    'resumed-work': '#/context',
  }
  const target = routes[w.type]
  if (target) window.location.hash = target
}

export const AdaptiveHomeWidgets: FC = () => {
  const qc = useQueryClient()
  const shownWhy = useRef(new Set<string>())

  const { data, isLoading, error } = useQuery({
    queryKey: HOME_KEY,
    queryFn: fetchHome,
    staleTime: 60_000,
  })

  const prefMutation = useMutation({
    mutationFn: async (input: {
      kind: 'pin' | 'hide' | 'dismiss'
      widget: string
    }) => {
      const base = await getAgentServerUrl()
      const res = await fetch(`${base}/scheduler/home/prefs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`Pref failed: ${res.status}`)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: HOME_KEY }),
  })

  const addProposalMutation = useMutation({
    mutationFn: async (widget: HomeWidget) => {
      const base = await getAgentServerUrl()
      const res = await fetch(`${base}/scheduler/home/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: widget.title,
          source: widget.source ?? { type: 'template' },
          action: widget.action ?? { type: 'open-route', target: '#/home' },
          refreshMinutes: 5,
          createdBy: 'agent',
          whyText: widget.why,
          status: 'active',
        }),
      })
      if (widget.id) {
        await fetch(`${base}/scheduler/home/widgets/${widget.id}`, {
          method: 'DELETE',
        })
      }
      if (!res.ok) throw new Error('Failed to add widget')
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: HOME_KEY }),
  })

  const dismissProposalMutation = useMutation({
    mutationFn: async (widget: HomeWidget) => {
      if (!widget.id) return
      const base = await getAgentServerUrl()
      await fetch(`${base}/scheduler/home/widgets/${widget.id}`, {
        method: 'DELETE',
      })
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: HOME_KEY }),
  })

  const actionMutation = useMutation({
    mutationFn: async (widget: HomeWidget) => {
      if (!widget.id) return
      const base = await getAgentServerUrl()
      await fetch(`${base}/scheduler/home/widgets/${widget.id}/action`, {
        method: 'POST',
      })
      const action = widget.action
      if (!action) return
      if (action.type === 'open-route' || action.type === 'navigate') {
        window.location.hash = action.target
      }
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: HOME_KEY }),
  })

  if (isLoading) {
    return (
      <div className="text-muted-foreground text-sm">Loading your day…</div>
    )
  }
  if (error) {
    return (
      <div className="text-muted-foreground text-sm">
        Could not load home widgets. The agent server may be starting up.
      </div>
    )
  }

  const activeWidgets = (data?.widgets ?? []).filter(
    (w) => w.type !== 'recent-sites-fallback',
  )
  const proposals = data?.proposals ?? []

  if (activeWidgets.length === 0 && proposals.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyHomeState />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Staged proposals at the top */}
      {proposals.map((p) => (
        <ProposalCard
          key={p.id ?? p.type}
          widget={p}
          onAdd={() => addProposalMutation.mutate(p)}
          onDismiss={() => dismissProposalMutation.mutate(p)}
        />
      ))}

      {/* Active widget cards */}
      {activeWidgets.map((w) => {
        const showWhy = !shownWhy.current.has(w.id ?? w.type)
        if (showWhy) shownWhy.current.add(w.id ?? w.type)
        return (
          <WidgetCard
            key={w.id ?? w.type}
            widget={w}
            showWhyInline={showWhy}
            onPin={() =>
              prefMutation.mutate({ kind: 'pin', widget: w.id ?? w.type })
            }
            onHide={() =>
              prefMutation.mutate({ kind: 'hide', widget: w.id ?? w.type })
            }
            onDismiss={() =>
              prefMutation.mutate({ kind: 'dismiss', widget: w.id ?? w.type })
            }
            onAction={() => {
              if (w.id) {
                actionMutation.mutate(w)
              } else {
                handleCuratedAction(w)
              }
            }}
          />
        )
      })}

      {/* Add widget affordance */}
      <div className="pt-1 text-center">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-muted-foreground text-xs hover:text-foreground"
          onClick={() => {
            const url = new URL(window.location.href)
            url.searchParams.set('prefill', 'Add a widget for ')
            window.history.replaceState(null, '', url.toString())
            document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
          }}
        >
          <Plus className="h-3 w-3" />
          Add a widget
        </Button>
      </div>
    </div>
  )
}
