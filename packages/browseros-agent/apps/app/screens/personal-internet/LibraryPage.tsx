/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Clock3, FolderOpen } from 'lucide-react'
import type { FC } from 'react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { libraryHref } from '@/lib/personal-internet/pi-href'
import { PiAddressChip, PiLinkActions, PiRailAction } from './PiChrome'
import {
  type PiLibrarySite,
  type PiLibraryTemp,
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
    <div className="min-w-0 flex-1">
      <Link
        to={`/pi/sites/${site.id}`}
        className="line-clamp-2 font-medium text-foreground [overflow-wrap:anywhere] hover:underline"
        title={site.name}
      >
        {site.name}
      </Link>
      <div
        className="mt-1 line-clamp-2 text-muted-foreground text-xs [overflow-wrap:anywhere]"
        title={site.pulseLine}
      >
        {site.status}
        {site.pulseLine ? ` · ${site.pulseLine}` : ''}
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-2">
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

const TempRow: FC<{ temp: PiLibraryTemp }> = ({ temp }) => (
  <li className="flex items-center justify-between gap-4 px-4 py-3">
    <div className="min-w-0 flex-1">
      <Link
        to={`/pi/temp/${temp.id}`}
        title={temp.title}
        className="line-clamp-2 font-medium text-foreground [overflow-wrap:anywhere] hover:underline"
      >
        {temp.title}
      </Link>
      <p className="mt-1 text-muted-foreground text-xs">
        {temp.expiresAt <= Date.now()
          ? 'Expired'
          : `Temporary · expires ${new Date(temp.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
      </p>
    </div>
    <PiRailAction to={`/pi/temp/${temp.id}`} className="shrink-0">
      Open
    </PiRailAction>
  </li>
)

export const LibraryPage: FC = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const showTemps = searchParams.get('view') === 'temporary'
  const query = usePiLibrary()
  const sites = query.data?.sites ?? []
  const temps = query.data?.temps ?? []
  const [showArchived, setShowArchived] = useState(false)
  const archivedQuery = usePiArchivedSites(showArchived)
  const archivedSites = archivedQuery.data?.sites ?? []

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-semibold text-xl">Your work</h1>
          <p className="text-muted-foreground text-sm">
            Sites you’ve saved and pages you’re still working on.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PiAddressChip href={libraryHref()} />
            <PiLinkActions href={libraryHref()} bookmarkTitle="Your work" />
          </div>
        </div>
        <PiRailAction to="/home">Home</PiRailAction>
      </div>
      <nav
        aria-label="Work categories"
        className="mb-5 flex border-border border-b"
      >
        {[
          {
            temporary: false,
            label: 'Sites',
            count: sites.length,
            Icon: FolderOpen,
          },
          {
            temporary: true,
            label: 'Temporary pages',
            count: temps.length,
            Icon: Clock3,
          },
        ].map(({ temporary, label, count, Icon }) => (
          <button
            key={label}
            type="button"
            aria-pressed={showTemps === temporary}
            className={`flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm ${showTemps === temporary ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() =>
              setSearchParams(temporary ? { view: 'temporary' } : {})
            }
          >
            <Icon className="size-4" />
            {label}
            <span className="font-mono text-muted-foreground text-xs">
              {count}
            </span>
          </button>
        ))}
      </nav>
      {query.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border border-border p-4 text-sm"
        >
          <p>Your work couldn’t load.</p>
          <PiRailAction onClick={() => void query.refetch()}>
            Retry
          </PiRailAction>
        </div>
      ) : query.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : showTemps ? (
        <>
          <p className="mb-4 text-muted-foreground text-xs">
            Open a page and choose Keep to save it as a site.
          </p>
          {temps.length ? (
            <ul className="divide-y divide-border border border-border">
              {temps.map((temp) => (
                <TempRow key={temp.id} temp={temp} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">No temporary pages.</p>
          )}
        </>
      ) : sites.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sites saved yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {sites.map((site) => (
            <SiteRow key={site.id} site={site} />
          ))}
        </ul>
      )}

      {!showTemps ? (
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
                <ul className="divide-y divide-border/60 border border-border/40 bg-muted/20">
                  {archivedSites.map((s) => (
                    <SiteRow key={s.id} site={s} archived />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
