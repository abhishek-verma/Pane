/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BoardKanban } from './BoardKanban'
import type { PiAction, PiNode, PiPageDoc } from './types'
import { PiChartView } from './viz/PiChartView'
import { PiMermaidView } from './viz/PiMermaidView'
import { PiSvgView } from './viz/PiSvgView'

const toneClass: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground',
  good: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  bad: 'bg-red-500/15 text-red-700 dark:text-red-300',
}

export type PiActionHandler = (
  action: PiAction,
  ctx?: { pendingKey?: string },
) => void | Promise<void>

function nodeKey(node: PiNode, path: string): string {
  switch (node.type) {
    case 'title':
    case 'text':
    case 'note':
      return `${path}:${node.type}:${node.text.slice(0, 48)}`
    case 'badge':
      return `${path}:badge:${node.tone ?? 'neutral'}:${node.text.slice(0, 32)}`
    case 'divider':
      return `${path}:divider`
    case 'button':
      return `${path}:button:${node.label}`
    case 'link':
      return `${path}:link:${node.label}`
    case 'stack':
      return `${path}:stack:${node.direction ?? 'col'}:${node.children.length}`
    case 'table':
      return `${path}:table:${node.rows.map((r) => r.id).join(',')}`
    case 'board':
      return `${path}:board:${node.cards.map((c) => c.id).join(',')}`
    case 'chart':
      return `${path}:chart:${node.chartType}:${node.data.map((d) => d.label).join(',')}`
    case 'mermaid':
      return `${path}:mermaid:${(node.title ?? '').slice(0, 24)}:${node.source.length}`
    case 'svg':
      return `${path}:svg:${(node.title ?? node.alt ?? '').slice(0, 24)}:${node.markup.length}`
  }
}

const PiNodeView: FC<{
  node: PiNode
  path: string
  onAction: PiActionHandler
  pendingKey?: string | null
  onMoveCard?: (cardId: string, toColumnId: string) => void | Promise<void>
  siteId?: string
}> = ({ node, path, onAction, pendingKey, onMoveCard, siteId }) => {
  switch (node.type) {
    case 'title':
      return (
        <h1 className="font-semibold text-2xl text-foreground tracking-tight">
          {node.text}
        </h1>
      )
    case 'text':
      return (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {node.text}
        </p>
      )
    case 'note':
      return (
        <p className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-foreground text-sm">
          {node.text}
        </p>
      )
    case 'badge':
      return (
        <span
          className={cn(
            'inline-flex rounded-full px-2.5 py-0.5 font-medium text-xs',
            toneClass[node.tone ?? 'neutral'],
          )}
        >
          {node.text}
        </span>
      )
    case 'divider':
      return <hr className="border-border/70" />
    case 'stack':
      return (
        <div
          className={cn(
            'flex gap-3',
            node.direction === 'row' ? 'flex-row flex-wrap' : 'flex-col',
          )}
        >
          {node.children.map((child) => {
            const childPath = nodeKey(child, path)
            return (
              <PiNodeView
                key={childPath}
                node={child}
                path={childPath}
                onAction={onAction}
                pendingKey={pendingKey}
                onMoveCard={onMoveCard}
                siteId={siteId}
              />
            )
          })}
        </div>
      )
    case 'button': {
      const key = `btn:${node.label}`
      const pending = pendingKey === key
      return (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => void onAction(node.action, { pendingKey: key })}
        >
          {pending ? 'Working…' : node.label}
        </Button>
      )
    }
    case 'link':
      return (
        <button
          type="button"
          className="font-medium text-[var(--accent-orange)] text-sm underline-offset-2 hover:underline"
          onClick={() => void onAction(node.action)}
        >
          {node.label}
        </button>
      )
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {node.columns.map((c) => (
                  <th key={c.id} className="px-3 py-2 font-medium">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row) => (
                <tr key={row.id} className="border-border/60 border-t">
                  {node.columns.map((c) => {
                    const cell = row.cells[c.id]
                    return (
                      <td key={c.id} className="px-3 py-2 align-top">
                        {typeof cell === 'string' || cell == null ? (
                          (cell ?? '')
                        ) : (
                          <PiNodeView
                            node={cell}
                            path={`${path}:cell:${row.id}:${c.id}`}
                            onAction={onAction}
                            pendingKey={pendingKey}
                            siteId={siteId}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'board':
      return (
        <BoardKanban
          node={node}
          siteId={siteId}
          onAction={(action) => void onAction(action)}
          onMoveCard={onMoveCard}
        />
      )
    case 'chart':
      return <PiChartView node={node} />
    case 'mermaid':
      return <PiMermaidView node={node} />
    case 'svg':
      return <PiSvgView node={node} />
    default:
      return null
  }
}

export const PiPageRenderer: FC<{
  doc: PiPageDoc
  onAction: PiActionHandler
  pendingKey?: string | null
  onMoveCard?: (cardId: string, toColumnId: string) => void | Promise<void>
  siteId?: string
}> = ({ doc, onAction, pendingKey, onMoveCard, siteId }) => {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-6"
      style={
        {
          '--pi-accent': 'var(--signal)',
        } as React.CSSProperties
      }
    >
      <div className="flex flex-col gap-4">
        {doc.nodes.map((node) => {
          const path = nodeKey(node, 'root')
          return (
            <PiNodeView
              key={path}
              node={node}
              path={path}
              onAction={onAction}
              pendingKey={pendingKey}
              onMoveCard={onMoveCard}
              siteId={siteId}
            />
          )
        })}
      </div>
    </div>
  )
}
