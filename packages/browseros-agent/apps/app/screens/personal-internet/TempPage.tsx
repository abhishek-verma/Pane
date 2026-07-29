/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { useQueryClient } from '@tanstack/react-query'
import { type FC, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { executePiAction } from '@/lib/pi-actions'
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
      <div className="flex items-center justify-between gap-3 border-border/60 border-b px-4 py-3">
        <div>
          <div className="font-medium text-sm">Temporary page</div>
          <div className="text-muted-foreground text-xs">
            Keep to save into your private web, or discard.
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (!tempId) return
              setBusy(true)
              try {
                await piDelete(`/pi/temps/${tempId}`)
                navigate('/home')
              } finally {
                setBusy(false)
              }
            }}
          >
            Discard
          </Button>
          <Button
            size="sm"
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
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/home">Home</Link>
          </Button>
        </div>
      </div>
      <PiPageRenderer
        doc={query.data.doc}
        onAction={(action) => executePiAction(action)}
      />
    </div>
  )
}
