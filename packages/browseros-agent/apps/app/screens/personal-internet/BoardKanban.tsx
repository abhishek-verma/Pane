/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { type FC, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
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

export const BoardKanban: FC<{
  node: BoardNode
  onAction: (action: PiAction) => void | Promise<void>
  onMoveCard?: (cardId: string, toColumnId: string) => void | Promise<void>
}> = ({ node, onAction, onMoveCard }) => {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {node.columns.map((col) => (
        // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 DnD drop column
        <div
          key={col.id}
          className={cn(
            'flex w-56 shrink-0 flex-col rounded-lg border border-border/70 bg-card/40 p-3',
            overCol === col.id && 'border-[var(--pi-accent)]/60',
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
          <div className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {col.title}
            <span className="ml-1 font-normal opacity-70">
              ({col.cardIds.length})
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {col.cardIds.map((cardId) => {
              const card = node.cards.find((c) => c.id === cardId)
              if (!card) return null
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 DnD card
                <div
                  key={card.id}
                  draggable={!!onMoveCard}
                  onDragStart={(e) => {
                    setDraggingId(card.id)
                    e.dataTransfer.setData('text/pi-card', card.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => {
                    setDraggingId(null)
                    setOverCol(null)
                  }}
                  className={cn(
                    'rounded-md border border-border/60 bg-background p-3 shadow-sm',
                    onMoveCard && 'cursor-grab active:cursor-grabbing',
                    draggingId === card.id && 'opacity-60',
                  )}
                >
                  <div className="font-medium text-foreground">
                    {card.title}
                  </div>
                  {card.subtitle ? (
                    <div className="mt-0.5 text-muted-foreground text-xs">
                      {card.subtitle}
                    </div>
                  ) : null}
                  {card.actions?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
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
                          <Button
                            key={key}
                            size="sm"
                            variant="outline"
                            onClick={() => void onAction(action)}
                          >
                            {label}
                          </Button>
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
