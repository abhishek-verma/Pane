/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useState } from 'react'
import { usePiRecords } from './usePiApi'

export const RecordsPanel: FC<{ siteId: string }> = ({ siteId }) => {
  const [open, setOpen] = useState(false)
  const query = usePiRecords(siteId, open)

  return (
    <div className="border-border/40 border-t px-4 py-3">
      <button
        type="button"
        className="font-medium text-muted-foreground text-xs uppercase tracking-wide hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        Records {open ? '▾' : '▸'}
        {query.data ? ` (${query.data.records.length})` : ''}
      </button>
      {open ? (
        <div className="mt-2 overflow-x-auto">
          {query.isLoading ? (
            <div className="text-muted-foreground text-xs">Loading…</div>
          ) : query.data?.records.length ? (
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Company</th>
                  <th className="py-1 pr-3 font-medium">Stage</th>
                  <th className="py-1 font-medium">Next</th>
                </tr>
              </thead>
              <tbody>
                {query.data.records.map((r) => (
                  <tr key={r.id} className="border-border/30 border-t">
                    <td className="py-1.5 pr-3 text-foreground">
                      {String(r.data.company ?? r.data.name ?? r.id)}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {String(r.data.stage ?? r.data.status ?? '—')}
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {String(r.data.nextAction ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-muted-foreground text-xs">
              No records yet — add applications via chat (
              <code>pi_record_upsert</code>).
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
