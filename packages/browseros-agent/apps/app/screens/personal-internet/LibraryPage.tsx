/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { libraryHref } from '@/lib/personal-internet/pi-href'
import { PiAddressChip, PiLinkActions, PiRailAction } from './PiChrome'
import {
  type PiLibrarySite,
  piDelete,
  piPost,
  usePiArchivedSites,
  usePiLibrary,
} from './usePiApi'

const SiteRow: FC<{ site: PiLibrarySite; archived?: boolean }> = ({
  site,
  archived = false,
}) => (
  <li
    className={`flex items-center justify-between gap-3 px-4 py-3 ${archived ? 'opacity-60' : ''}`}
  >
    <div>
      <Link
        to={`/pi/sites/${site.id}`}
        className="font-medium text-foreground hover:underline"
      >
        {site.name}
      </Link>
      <div className="text-muted-foreground text-xs">
        {site.status}
        {site.pulseLine ? ` · ${site.pulseLine}` : ''}
      </div>
    </div>
    <div className="flex items-center gap-2">
      <PiRailAction to={`/pi/sites/${site.id}`}>Open</PiRailAction>
      {!archived && (
        <PiRailAction
          variant="destructive"
          onClick={() => {
            if (!window.confirm(`Archive "${site.name}"?`)) return
            void piPost(`/pi/sites/${site.id}/archive`)
          }}
        >
          Archive
        </PiRailAction>
      )}
      {archived && (
        <PiRailAction
          variant="destructive"
          onClick={() => {
            if (
              !window.confirm(
                `Permanently delete "${site.name}"? This cannot be undone.`,
              )
            )
              return
            void piDelete(`/pi/sites/${site.id}?confirm=1`)
          }}
        >
          Delete
        </PiRailAction>
      )}
    </div>
  </li>
)

export const LibraryPage: FC = () => {
  const query = usePiLibrary()
  const sites = query.data?.sites ?? []
  const [showArchived, setShowArchived] = useState(false)
  const archivedQuery = usePiArchivedSites(showArchived)
  const archivedSites = archivedQuery.data?.sites ?? []

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
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
        <PiRailAction to="/home">Home</PiRailAction>
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
            <SiteRow key={s.id} site={s} />
          ))}
        </ul>
      )}

      <div className="mt-6">
        <button
          type="button"
          className="text-muted-foreground text-xs hover:text-foreground hover:underline"
          onClick={() => setShowArchived((v) => !v)}
        >
          {showArchived ? 'Hide archived sites' : 'Show archived sites'}
        </button>
        {showArchived && (
          <div className="mt-3">
            <h2 className="mb-2 font-medium text-muted-foreground text-sm">
              Archived
            </h2>
            {archivedQuery.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : archivedSites.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No archived sites.
              </p>
            ) : (
              <ul className="divide-y divide-border/60 rounded-lg border border-border/40 bg-muted/20">
                {archivedSites.map((s) => (
                  <SiteRow key={s.id} site={s} archived />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
