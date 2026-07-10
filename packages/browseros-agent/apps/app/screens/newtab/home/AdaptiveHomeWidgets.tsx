/**
 * Adaptive home widgets — loads cached digest + local queries only.
 * Never calls chat/LLM endpoints.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FC, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

export interface HomeWidget {
  type: string
  title: string
  why: string
  rank: number
  pinned?: boolean
  data: Record<string, unknown>
}

const HOME_KEY = ['scheduler', 'home'] as const

/** Module-level flag for tests: home loader must not hit /chat. */
export let homeLoaderCalledChat = false
export function resetHomeLoaderChatFlag() {
  homeLoaderCalledChat = false
}

async function fetchHome(): Promise<{ widgets: HomeWidget[] }> {
  const base = await getAgentServerUrl()
  // Perf / ship-gate: only /scheduler/home — never /chat or generateText.
  const url = `${base}/scheduler/home`
  if (url.includes('/chat')) homeLoaderCalledChat = true
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Home load failed: ${res.status}`)
  return res.json() as Promise<{ widgets: HomeWidget[] }>
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: HOME_KEY })
    },
  })

  if (isLoading) {
    return (
      <div className="text-muted-foreground text-sm">Loading your day…</div>
    )
  }
  if (error) {
    return null
  }

  const widgets = (data?.widgets ?? []).filter(
    (w) => w.type !== 'recent-sites-fallback',
  )
  if (widgets.length === 0) return null

  return (
    <div className="flex flex-col gap-4">
      {widgets.map((w) => {
        const showWhy = !shownWhy.current.has(w.type)
        if (showWhy) shownWhy.current.add(w.type)
        return (
          <section
            key={w.type}
            className="border-border/60 border-b pb-4 last:border-0"
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <h2 className="font-medium text-sm">{w.title}</h2>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    prefMutation.mutate({ kind: 'pin', widget: w.type })
                  }
                >
                  Pin
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    prefMutation.mutate({ kind: 'hide', widget: w.type })
                  }
                >
                  Hide
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    prefMutation.mutate({ kind: 'dismiss', widget: w.type })
                  }
                >
                  Dismiss
                </Button>
              </div>
            </div>
            {showWhy && (
              <p className="mb-2 text-muted-foreground text-xs">{w.why}</p>
            )}
            <WidgetBody widget={w} />
          </section>
        )
      })}
    </div>
  )
}

const WidgetBody: FC<{ widget: HomeWidget }> = ({ widget }) => {
  if (widget.type === 'daily-digest') {
    const content = String(widget.data.content ?? '')
    return (
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-muted-foreground text-xs leading-5">
        {content.slice(0, 1200)}
      </pre>
    )
  }
  if (widget.type === 'pending-approvals') {
    const items = (widget.data.items as Array<Record<string, string>>) ?? []
    return (
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li key={item.id}>
            {item.toolName ?? item.title ?? item.id}
            {item.preview ? (
              <span className="text-muted-foreground">
                {' '}
                — {item.preview.slice(0, 80)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }
  if (widget.type === 'resumed-work') {
    const pages =
      (widget.data.pages as Array<{ title?: string; uri?: string }>) ?? []
    return (
      <ul className="space-y-1 text-sm">
        {pages.map((p, i) => (
          <li key={p.uri ?? String(i)}>{p.title ?? p.uri}</li>
        ))}
      </ul>
    )
  }
  if (widget.type === 'one-click-recurring') {
    const skills =
      (widget.data.skills as Array<{ id: string; name: string }>) ?? []
    return (
      <ul className="space-y-1 text-sm">
        {skills.map((s) => (
          <li key={s.id}>{s.name}</li>
        ))}
      </ul>
    )
  }
  return null
}
