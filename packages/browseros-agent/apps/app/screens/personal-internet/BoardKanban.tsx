/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { normalizeBoardForRender } from './normalizeBoard'
import { PiRailAction } from './PiChrome'
import { PiMarkdown } from './PiMarkdown'
import type { PiAction, PiCardAction, PiNode } from './types'

type BoardNode = Extract<PiNode, { type: 'board' }>

function normalizeCardAction(entry: PiCardAction): {
  label: string
  action: PiAction
} {
  if (
    entry &&
    typeof entry === 'object' &&
    'action' in entry &&
    entry.action &&
    typeof entry.action === 'object' &&
    'kind' in entry.action
  ) {
    const labeled = entry as { label?: unknown; action: PiAction }
    const label =
      typeof labeled.label === 'string' && labeled.label.trim()
        ? labeled.label.trim()
        : 'Open'
    return { label, action: labeled.action }
  }
  const action = entry as PiAction
  return {
    label:
      action.kind === 'agent'
        ? 'Ask agent'
        : action.kind === 'open-external'
          ? 'Open link'
          : action.kind === 'local'
            ? action.op
            : 'Open',
    action,
  }
}

function detailsActionForCard(
  card: BoardNode['cards'][number],
  siteId?: string,
): PiAction | null {
  const fromActions = card.actions
    ?.map((entry) => normalizeCardAction(entry))
    .find((a) => a.action.kind === 'open-internal')?.action
  if (fromActions) return fromActions
  const entityKey = card.entityKey?.trim()
  if (siteId && entityKey) {
    return {
      kind: 'open-internal',
      route: `#/pi/sites/${siteId}/entities/${encodeURIComponent(entityKey)}`,
    }
  }
  return null
}

export const BoardKanban: FC<{
  node: BoardNode
  onAction: (action: PiAction) => void | Promise<void>
  onMoveCard?: (cardId: string, toColumnId: string) => void | Promise<void>
  siteId?: string
}> = ({ node: rawNode, onAction, onMoveCard, siteId }) => {
  const node = normalizeBoardForRender(rawNode)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  // Suppress title click that browsers fire after a drag ends.
  const suppressClickRef = useRef(false)

  return (
    <div className="flex overflow-x-auto border-border border-y">
      {node.columns.map((col, colIndex) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 DnD drop column
        <div
          key={col.id}
          className={cn(
            'flex w-56 shrink-0 flex-col',
            colIndex > 0 && 'border-border border-l',
            overCol === col.id && 'bg-muted/40',
          )}
          onDragOver={(e) => {
            if (!onMoveCard) return
            e.preventDefault()
            setOverCol(col.id)
          }}
          onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
          onDrop={(e) => {
            if (!onMoveCard) return
            e.preventDefault()
            const cardId =
              e.dataTransfer.getData('text/pi-card') || draggingId || ''
            setOverCol(null)
            setDraggingId(null)
            if (cardId) void onMoveCard(cardId, col.id)
          }}
        >
          <div className="flex items-baseline justify-between gap-2 border-border border-b px-3 py-2.5">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-[0.06em]">
              {col.title}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/70 tabular-nums">
              {col.cardIds.length}
            </span>
          </div>
          <div className="flex min-h-[8rem] flex-col">
            {col.cardIds.map((cardId) => {
              const card = node.cards.find((c) => c.id === cardId)
              if (!card) return null
              const detailsAction = detailsActionForCard(card, siteId)
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 DnD card
                <div
                  key={card.id}
                  draggable={!!onMoveCard}
                  onDragStart={(e) => {
                    suppressClickRef.current = true
                    setDraggingId(card.id)
                    e.dataTransfer.setData('text/pi-card', card.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    setDraggingId(null)
                    setOverCol(null)
                    window.setTimeout(() => {
                      suppressClickRef.current = false
                    }, 0)
                  }}
                  className={cn(
                    'border-border border-b px-3 py-3',
                    onMoveCard && 'cursor-grab active:cursor-grabbing',
                    draggingId === card.id && 'opacity-50',
                  )}
                >
                  <button
                    type="button"
                    className="w-full text-left"
                    disabled={!detailsAction}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (
                        suppressClickRef.current ||
                        draggingId ||
                        !detailsAction
                      )
                        return
                      void onAction(detailsAction)
                    }}
                  >
                    <div className="font-medium text-foreground text-sm hover:underline">
                      {card.title}
                    </div>
                    {card.subtitle ? (
                      <div className="mt-0.5 text-muted-foreground text-xs leading-snug">
                        <PiMarkdown>{card.subtitle}</PiMarkdown>
                      </div>
                    ) : null}
                  </button>
                  {card.actions?.length ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {card.actions.map((entry) => {
                        const { label, action } = normalizeCardAction(entry)
                        const key =
                          action.kind === 'agent'
                            ? `${card.id}:agent:${action.query}`
                            : action.kind === 'open-external'
                              ? `${card.id}:ext:${action.url}`
                              : action.kind === 'open-internal'
                                ? `${card.id}:int:${action.route}`
                                : `${card.id}:${label}`
                        return (
                          <PiRailAction
                            key={key}
                            onClick={() => void onAction(action)}
                          >
                            {label}
                          </PiRailAction>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
