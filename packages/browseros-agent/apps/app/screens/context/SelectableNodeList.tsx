/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC, MouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { ContextNode } from './useContextApi'

export interface SelectableNodeListProps {
  title: string
  nodes: ContextNode[]
  selected: Set<string>
  onClick: (id: string, visibleIds: string[], shiftKey: boolean) => void
  /** Ids that render without a checkbox (e.g. non-graph search hits) — click is a no-op. */
  nonSelectableIds?: Set<string>
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => void
}

export const SelectableNodeList: FC<SelectableNodeListProps> = ({
  title,
  nodes,
  selected,
  onClick,
  nonSelectableIds,
  hasMore,
  loadingMore,
  onLoadMore,
}) => {
  if (nodes.length === 0) return null
  const visibleIds = nodes
    .filter((n) => !nonSelectableIds?.has(n.id))
    .map((n) => n.id)

  return (
    <section className="space-y-2">
      <h2 className="font-medium text-sm">{title}</h2>
      <ul className="space-y-2">
        {nodes.map((n) => {
          const disabled = nonSelectableIds?.has(n.id) ?? false
          return (
            <li key={n.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={(e: MouseEvent<HTMLButtonElement>) => {
                  if (disabled) return
                  onClick(n.id, visibleIds, e.shiftKey)
                }}
                className="flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm disabled:cursor-default disabled:opacity-70"
              >
                {disabled ? (
                  <span className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Checkbox
                    checked={selected.has(n.id)}
                    className="pointer-events-none mt-0.5"
                    tabIndex={-1}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <div className="font-medium">{n.title ?? '(untitled)'}</div>
                  {n.uri && (
                    <div className="truncate text-muted-foreground text-xs">
                      {n.uri}
                    </div>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? 'Loading…' : 'Show more'}
        </Button>
      )}
    </section>
  )
}
