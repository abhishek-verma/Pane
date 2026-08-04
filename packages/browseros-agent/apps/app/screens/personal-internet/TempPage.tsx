/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQueryClient } from '@tanstack/react-query'
import { type FC, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { navigateAppShell } from '@/lib/personal-internet/pi-document'
import { tempHref } from '@/lib/personal-internet/pi-href'
import { executePiAction } from '@/lib/pi-actions'
import { PiLinkActions, PiRailAction } from './PiChrome'
import { PiPageRenderer } from './PiPageRenderer'
import { piDelete, piPost, usePiTemp } from './usePiApi'

export const TempPage: FC = () => {
  const { tempId } = useParams()
  const query = usePiTemp(tempId)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  if (query.isLoading) {
    return <div className="p-6 text-muted-foreground text-sm">Loading…</div>
  }
  if (!query.data) {
    return (
      <div className="p-6 text-destructive text-sm">Temp page not found.</div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-border border-b px-5 py-3">
        <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
          <span className="text-foreground/80">Temp</span>
          <span className="mx-1.5 text-border">/</span>
          Keep to save, or discard
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tempId ? (
            <PiLinkActions
              href={tempHref(tempId)}
              bookmarkTitle={query.data.temp.title}
            />
          ) : null}
          <PiRailAction
            disabled={busy}
            onClick={async () => {
              if (!tempId) return
              setBusy(true)
              try {
                await piDelete(`/pi/temps/${tempId}`)
                navigateAppShell('/home')
              } finally {
                setBusy(false)
              }
            }}
          >
            Discard
          </PiRailAction>
          <PiRailAction
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (!tempId) return
              setBusy(true)
              try {
                const res = await piPost(`/pi/temps/${tempId}/preserve`, {
                  mode: 'standalone',
                })
                if (!res.ok) {
                  const errBody = (await res.json().catch(() => null)) as {
                    error?: string
                  } | null
                  throw new Error(
                    errBody?.error ?? `Keep failed (${res.status})`,
                  )
                }
                const data = (await res.json()) as {
                  route?: string
                  siteId?: string
                }
                void qc.invalidateQueries({ queryKey: ['scheduler', 'home'] })
                if (data.siteId) navigate(`/pi/sites/${data.siteId}`)
                else if (data.route?.startsWith('#/'))
                  navigate(data.route.slice(1))
                else navigate('/pi/library')
              } catch (e) {
                window.alert(
                  e instanceof Error ? e.message : 'Could not keep this page.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            Keep
          </PiRailAction>
          <PiRailAction to="/home">Home</PiRailAction>
        </div>
      </div>
      <PiPageRenderer
        doc={query.data.doc}
        onAction={(action) => executePiAction(action)}
      />
    </div>
  )
}
