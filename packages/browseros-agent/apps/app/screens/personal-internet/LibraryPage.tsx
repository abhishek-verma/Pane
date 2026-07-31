/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { libraryHref } from '@/lib/personal-internet/pi-href'
import { PiAddressChip, PiLinkActions } from './PiChrome'
import { usePiLibrary } from './usePiApi'

export const LibraryPage: FC = () => {
  const query = usePiLibrary()
  const sites = query.data?.sites ?? []

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl">My sites</h1>
          <p className="text-muted-foreground text-sm">
            Your Personalised Internet — living work pages.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PiAddressChip href={libraryHref()} />
            <PiLinkActions href={libraryHref()} bookmarkTitle="My sites" />
          </div>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link to="/home">Home</Link>
        </Button>
      </div>
      {query.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : sites.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No sites yet. Ask Pane to start a job search pipeline or research hub.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
          {sites.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <Link
                  to={`/pi/sites/${s.id}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {s.name}
                </Link>
                <div className="text-muted-foreground text-xs">
                  {s.status}
                  {s.pulseLine ? ` · ${s.pulseLine}` : ''}
                </div>
              </div>
              <Button asChild size="sm" variant="secondary">
                <Link to={`/pi/sites/${s.id}`}>Open</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
