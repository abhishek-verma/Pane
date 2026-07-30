/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useState } from 'react'
import { Link } from 'react-router'
import { usePiRecords } from './usePiApi'

function slugifyEntityKey(company: string): string {
  const base = company
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'company'
}

export const RecordsPanel: FC<{ siteId: string }> = ({ siteId }) => {
  const [open, setOpen] = useState(false)
  const query = usePiRecords(siteId, open)

  return (
    <div className="border-border border-t px-5 py-4">
      <button
        type="button"
        className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em] hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        Records {open ? '▾' : '▸'}
        {query.data ? ` · ${query.data.records.length}` : ''}
      </button>
      {open ? (
        <div className="mt-3 overflow-x-auto">
          {query.isLoading ? (
            <div className="font-mono text-[11px] text-muted-foreground">
              Loading…
            </div>
          ) : query.data?.records.length ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-border border-b">
                  <th className="py-2 pr-3 font-mono font-normal text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
                    Company
                  </th>
                  <th className="py-2 pr-3 font-mono font-normal text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
                    Stage
                  </th>
                  <th className="py-2 font-mono font-normal text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
                    Next
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.records.map((r) => {
                  const company = String(r.data.company ?? r.data.name ?? r.id)
                  const entityKey =
                    typeof r.data.entityKey === 'string' &&
                    r.data.entityKey.trim()
                      ? r.data.entityKey.trim()
                      : slugifyEntityKey(company)
                  return (
                    <tr key={r.id} className="border-border/70 border-t">
                      <td className="py-2 pr-3 text-foreground">
                        <Link
                          className="hover:underline"
                          to={`/pi/sites/${siteId}/entities/${encodeURIComponent(entityKey)}`}
                        >
                          {company}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground uppercase tracking-wide">
                        {String(r.data.stage ?? r.data.status ?? '—')}
                      </td>
                      <td className="py-2 text-muted-foreground text-xs">
                        {String(r.data.nextAction ?? '—')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="font-mono text-[11px] text-muted-foreground">
              No records yet — add applications via chat (
              <code>pi_record_upsert</code>).
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
