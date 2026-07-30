/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { FC } from 'react'
import { cn } from '@/lib/utils'
import { BoardKanban } from './BoardKanban'
import { PiRailAction } from './PiChrome'
import { PiMarkdown } from './PiMarkdown'
import type { PiAction, PiNode, PiPageDoc } from './types'
import { PiChartView } from './viz/PiChartView'
import { PiMermaidView } from './viz/PiMermaidView'
import { PiSvgView } from './viz/PiSvgView'

const toneClass: Record<string, string> = {
  neutral: 'border-border text-muted-foreground',
  good: 'border-emerald-600/40 text-emerald-800 dark:text-emerald-300',
  warn: 'border-amber-600/40 text-amber-900 dark:text-amber-200',
  bad: 'border-red-600/40 text-red-800 dark:text-red-300',
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
  titleIndex?: number
}> = ({ node, path, onAction, pendingKey, onMoveCard, siteId, titleIndex }) => {
  switch (node.type) {
    case 'title':
      return (
        <header className="flex flex-col gap-1 border-border border-b pb-4">
          {titleIndex != null && titleIndex > 0 ? (
            <div className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
              {String(titleIndex).padStart(2, '0')}
            </div>
          ) : null}
          <h1
            className={cn(
              'text-foreground tracking-tight',
              titleIndex === 0 || titleIndex == null
                ? 'font-semibold text-3xl'
                : 'font-medium text-xl',
            )}
          >
            {node.text}
          </h1>
        </header>
      )
    case 'text':
      return (
        <div className="max-w-prose text-foreground/85 text-sm leading-relaxed">
          <PiMarkdown>{node.text}</PiMarkdown>
        </div>
      )
    case 'note':
      return (
        <div className="border-border border-l-2 pl-3 text-foreground/80 text-sm leading-relaxed">
          <PiMarkdown>{node.text}</PiMarkdown>
        </div>
      )
    case 'badge':
      return (
        <span
          className={cn(
            'inline-flex border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]',
            toneClass[node.tone ?? 'neutral'],
          )}
        >
          {node.text}
        </span>
      )
    case 'divider':
      return <hr className="border-border" />
    case 'stack':
      return (
        <div
          className={cn(
            'flex gap-3',
            node.direction === 'row'
              ? 'flex-row flex-wrap items-center'
              : 'flex-col',
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
        <PiRailAction
          disabled={pending}
          onClick={() => void onAction(node.action, { pendingKey: key })}
        >
          {pending ? 'Working…' : node.label}
        </PiRailAction>
      )
    }
    case 'link':
      return (
        <button
          type="button"
          className="text-foreground/80 text-sm underline-offset-4 transition-colors hover:text-foreground hover:underline"
          onClick={() => void onAction(node.action)}
        >
          {node.label}
        </button>
      )
    case 'table':
      return (
        <div className="overflow-x-auto border-border border-y">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead>
              <tr className="border-border border-b">
                {node.columns.map((c) => (
                  <th
                    key={c.id}
                    className="px-3 py-2.5 font-mono font-normal text-[10px] text-muted-foreground uppercase tracking-[0.06em]"
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row) => (
                <tr key={row.id} className="border-border/70 border-t">
                  {node.columns.map((c) => {
                    const cell = row.cells[c.id]
                    return (
                      <td
                        key={c.id}
                        className="px-3 py-2.5 align-top text-foreground"
                      >
                        {typeof cell === 'string' || cell == null ? (
                          cell ? (
                            <PiMarkdown>{cell}</PiMarkdown>
                          ) : (
                            ''
                          )
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
  let titleCount = 0
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-8"
      style={
        {
          '--pi-accent': 'var(--signal)',
        } as React.CSSProperties
      }
    >
      {doc.nodes.map((node) => {
        const path = nodeKey(node, 'root')
        const titleIndex = node.type === 'title' ? titleCount++ : undefined
        return (
          <PiNodeView
            key={path}
            node={node}
            path={path}
            onAction={onAction}
            pendingKey={pendingKey}
            onMoveCard={onMoveCard}
            siteId={siteId}
            titleIndex={titleIndex}
          />
        )
      })}
    </div>
  )
}
